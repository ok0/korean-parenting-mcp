import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const USAGE =
  "사용법: node scripts/build-regions.mjs --bjd <csv> --bjd-as-of YYYY-MM-DD --kg <html> --retrieved YYYY-MM-DD [--out data/regions.json]";
const HEADER = "법정동코드,시도명,시군구명,읍면동명,리명,순번,생성일자";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const KG_NAME_EXCEPTIONS = { "36110": "세종특별자치시" };
const SIDO_ALIASES = {
  "11": ["서울", "서울시"],
  "12": ["전남광주", "전남광주특별시", "광주", "광주광역시", "전라남도", "전남"],
  "26": ["부산", "부산시"],
  "27": ["대구", "대구시"],
  "28": ["인천", "인천시"],
  "30": ["대전", "대전시"],
  "31": ["울산", "울산시"],
  "36": ["세종", "세종특별시"],
  "41": ["경기"],
  "43": ["충북"],
  "44": ["충남"],
  "47": ["경북"],
  "48": ["경남"],
  "50": ["제주", "제주도"],
  "51": ["강원", "강원도"],
  "52": ["전북", "전라북도"],
};
const ABOLISHED = [
  {
    sido_code: "28",
    name: "서구",
    abolished_on: "2026-07-01",
    successor_codes: ["28275", "28290"],
    verified: "partial",
    note: "서해구·검단구로 분리(research/region-codes.md C7)",
  },
  {
    sido_code: "28",
    name: "중구",
    abolished_on: "2026-07-01",
    successor_codes: ["28125", "28155"],
    verified: "false",
    note: "제물포구·영종구로 개편. 후속 관계는 법정동 파일의 동 소속으로 추정, 공식 대조 전",
  },
  {
    sido_code: "28",
    name: "동구",
    abolished_on: "2026-07-01",
    successor_codes: ["28125"],
    verified: "false",
    note: "제물포구로 개편. 법정동 파일의 동 소속으로 추정, 공식 대조 전",
  },
  {
    sido_code: "47",
    name: "군위군",
    abolished_on: "2023-07-01",
    successor_codes: ["27720"],
    verified: "partial",
    note: "대구광역시 편입(research/region-codes.md C4)",
  },
];
const NOTE =
  "현존 시군구는 법정동 파일의 시군구 행(읍면동·리 공란)에서 생성. verified partial=법정동 파일과 유치원알리미 코드표 일치, false=코드표에 없어 대조 불가. nemc_q0은 정식 명칭, nemc_q1은 정식 명칭에서 공백을 뺀 값(일반구는 NEMC가 공백 없는 표기만 받음, M12 확인). 5자리 코드=법정동코드 앞 5자리(정황 근거, research/region-codes.md C3). 광주광역시·전라남도는 전남광주통합특별시 별칭으로만 남김.";
const BJD_DATASET = "국토교통부_전국 법정동_20260630";
const BJD_URL = "https://www.data.go.kr/data/15063424/fileData.do";
const BJD_LICENSE = "이용허락범위 제한 없음";
const KG_DATASET = "유치원알리미 시도시군구코드";
const KG_PROVIDER = "교육부 유치원알리미";
const KG_URL = "https://e-childschoolinfo.moe.go.kr/openApi/sidoSigunguCode.do";
const KG_LICENSE = "공식 사이트 공개 코드표(코드 대조와 codes.kindergarten에만 사용)";

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function compact(s) {
  return s.normalize("NFKC").replace(/\s+/g, "");
}

function byText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function parseArgs(argv) {
  const known = ["bjd", "bjd-as-of", "kg", "retrieved", "out"];
  const opts = { out: "data/regions.json" };
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    const name = typeof flag === "string" && flag.startsWith("--") ? flag.slice(2) : "";
    if (!known.includes(name) || value === undefined || value.startsWith("--")) fail(USAGE);
    opts[name] = value;
  }
  for (const name of ["bjd", "bjd-as-of", "kg", "retrieved"]) {
    if (opts[name] === undefined) fail(USAGE);
  }
  for (const name of ["bjd-as-of", "retrieved"]) {
    if (!DATE_RE.test(opts[name])) fail(`--${name}: 날짜 형식은 YYYY-MM-DD 입니다`);
  }
  return opts;
}

function readBytes(path) {
  try {
    return readFileSync(path);
  } catch {
    fail(`파일을 읽을 수 없습니다: ${path}`);
  }
}

function parseBjd(buf) {
  const text = buf.toString("utf8").replace(/^﻿/, "");
  const lines = text.split(/\r?\n/);
  const sidos = [];
  const sggs = [];
  let headerSeen = false;
  lines.forEach((line, idx) => {
    const row = idx + 1;
    if (line.trim() === "") return;
    if (!headerSeen) {
      if (line !== HEADER) fail(`법정동 파일 헤더가 예상과 다릅니다(행 ${row})`);
      headerSeen = true;
      return;
    }
    if (line.includes('"')) fail(`법정동 파일 ${row}행: 따옴표(")가 포함되어 있습니다`);
    const fields = line.split(",");
    if (fields.length !== 7) fail(`법정동 파일 ${row}행: 필드 수는 7이어야 합니다(현재 ${fields.length})`);
    const [code, sidoName, sggName, dong, ri, , created] = fields;
    if (!/^\d{10}$/.test(code)) fail(`법정동 파일 ${row}행: 법정동코드 형식 오류`);
    if (!DATE_RE.test(created)) fail(`법정동 파일 ${row}행: 생성일자 형식 오류`);
    if (sggName === "" && dong === "" && ri === "" && code.slice(2) === "00000000") {
      if (sidoName === "") fail(`법정동 파일 ${row}행: 시도명이 비어 있습니다`);
      sidos.push({ code: code.slice(0, 2), name: sidoName, row });
    } else if (sggName !== "" && dong === "" && ri === "" && code.slice(5) === "00000") {
      sggs.push({ code5: code.slice(0, 5), sido_code: code.slice(0, 2), rawName: sggName, created, row });
    }
  });
  if (!headerSeen) fail("법정동 파일이 비어 있습니다");
  const sidoSeen = new Set();
  for (const s of sidos) {
    if (sidoSeen.has(s.code)) fail(`법정동 파일 ${s.row}행: 시도 코드 중복 ${s.code}`);
    sidoSeen.add(s.code);
  }
  const sggSeen = new Set();
  for (const s of sggs) {
    if (!sidoSeen.has(s.sido_code)) fail(`법정동 파일 ${s.row}행: 시도 행이 없는 시군구입니다`);
    if (sggSeen.has(s.code5)) fail(`법정동 파일 ${s.row}행: 시군구 코드 중복 ${s.code5}`);
    sggSeen.add(s.code5);
  }
  return { sidos, sggs };
}

function linkParents(sggs) {
  return sggs.map((S) => {
    let best;
    for (const P of sggs) {
      if (P.sido_code !== S.sido_code) continue;
      if (P.code5[4] !== "0") continue;
      if (P.code5.slice(0, 4) !== S.code5.slice(0, 4)) continue;
      if (P.code5 === S.code5) continue;
      if (!(S.rawName.startsWith(P.rawName) && S.rawName.length > P.rawName.length)) continue;
      if (!best || P.rawName.length > best.rawName.length) best = P;
    }
    const name = best ? `${best.rawName} ${S.rawName.slice(best.rawName.length)}` : S.rawName;
    return { ...S, parent: best, name };
  });
}

function sigunguAliases(entry, bannedKeys) {
  const raw = [];
  if (entry.parent) {
    const gu = entry.rawName.slice(entry.parent.rawName.length);
    const stem = entry.parent.rawName.replace(/시$/, "");
    raw.push(`${stem} ${gu}`, gu);
  } else if (!/\s/.test(entry.rawName) && entry.rawName.endsWith("시") && entry.rawName.length >= 3) {
    raw.push(entry.rawName.slice(0, -1));
  }
  const nameKey = compact(entry.name);
  const out = [];
  for (const a of raw) {
    const key = compact(a);
    if (key === "" || key === nameKey || bannedKeys.has(key)) continue;
    if (!out.includes(a)) out.push(a);
  }
  return out;
}

function parseKg(buf) {
  const text = buf.toString("utf8");
  const cells = [];
  for (const m of text.matchAll(/<td[^>]*>([^<]*)<\/td>/g)) cells.push(m[1].trim());
  if (cells.length === 0 || cells.length % 4 !== 0) {
    fail(`유치원알리미 HTML: 셀 수(${cells.length})는 4의 배수여야 합니다`);
  }
  const rows = [];
  for (let i = 0; i < cells.length; i += 4) {
    const [sidoName, sidoCode, sggName, sggCode] = cells.slice(i, i + 4);
    const row = i / 4 + 1;
    if (!/^\d{2}$/.test(sidoCode)) fail(`유치원알리미 ${row}행: 시도코드 형식 오류`);
    if (!/^\d{5}$/.test(sggCode)) fail(`유치원알리미 ${row}행: 시군구코드 형식 오류`);
    rows.push({ row, sidoName, sidoCode, sggName, sggCode });
  }
  return rows;
}

const opts = parseArgs(process.argv.slice(2));
const bjdBuf = readBytes(opts.bjd);
const kgBuf = readBytes(opts.kg);
const bjdSha = sha256(bjdBuf);
const kgSha = sha256(kgBuf);
const parsed = parseBjd(bjdBuf);
const kgRows = parseKg(kgBuf);

const sidoMap = new Map(parsed.sidos.map((s) => [s.code, s.name]));
const aliasCodes = Object.keys(SIDO_ALIASES);
if (aliasCodes.length !== sidoMap.size || ![...sidoMap.keys()].every((c) => Object.hasOwn(SIDO_ALIASES, c))) {
  fail("시도 별칭 상수의 코드 집합이 법정동 파일의 시도 코드 집합과 다릅니다");
}

const linked = linkParents(parsed.sggs);
const sggByCode = new Map(linked.map((s) => [s.code5, s]));
const kgSidoCodes = new Set(kgRows.map((r) => r.sidoCode));

const errors = [];
const kgMatch = new Map();
for (const r of kgRows) {
  const csvSido = sidoMap.get(r.sidoCode);
  if (csvSido === undefined) {
    errors.push(`유치원알리미 ${r.row}행: 시도코드 ${r.sidoCode}가 법정동 파일에 없습니다`);
  } else if (csvSido !== r.sidoName) {
    errors.push(`유치원알리미 ${r.row}행: 시도명이 법정동 파일과 다릅니다`);
  }
  const csvSgg = sggByCode.get(r.sggCode);
  if (csvSgg === undefined) {
    errors.push(`유치원알리미 ${r.row}행: 시군구코드 ${r.sggCode}가 법정동 파일에 없습니다`);
    continue;
  }
  const exception = KG_NAME_EXCEPTIONS[r.sggCode];
  const nameOk =
    compact(csvSgg.name) === compact(r.sggName) ||
    (exception !== undefined && compact(exception) === compact(r.sggName));
  if (!nameOk) {
    errors.push(`유치원알리미 ${r.row}행: 시군구명이 법정동 파일과 다릅니다`);
  }
  if (!kgMatch.has(r.sggCode)) kgMatch.set(r.sggCode, { sido: r.sidoCode, sgg: r.sggCode });
}
if (errors.length > 0) fail(errors.join("\n"));

const sidoCompacts = new Set();
for (const [code, name] of sidoMap) {
  sidoCompacts.add(compact(name));
  for (const a of SIDO_ALIASES[code]) sidoCompacts.add(compact(a));
}

const sido = [...sidoMap.entries()]
  .sort(([a], [b]) => byText(a, b))
  .map(([code, name]) => ({
    code,
    name,
    aliases: [...SIDO_ALIASES[code]],
    nemc_q0: name,
    ...(kgSidoCodes.has(code) ? { kindergarten_code: code } : {}),
  }));

const sigungu = linked
  .slice()
  .sort((a, b) => byText(a.code5, b.code5))
  .map((s) => {
    const kg = kgMatch.get(s.code5);
    return {
      code: s.code5,
      sido_code: s.sido_code,
      name: s.name,
      ...(s.parent ? { parent_code: s.parent.code5 } : {}),
      aliases: sigunguAliases(s, sidoCompacts),
      nemc_q1: s.name.replace(/\s+/g, ""),
      codes: kg ? { kindergarten: { sido: kg.sido, sgg: kg.sgg } } : {},
      verified: kg ? "partial" : "false",
      created: s.created,
    };
  });

const sggCodes = new Set(sigungu.map((s) => s.code));
for (const a of ABOLISHED) {
  for (const c of a.successor_codes) {
    if (!sggCodes.has(c)) fail(`폐지 항목(${a.name}) 후속 코드가 현존 시군구에 없습니다: ${c}`);
  }
}

const doc = {
  as_of: opts.retrieved,
  verified: "partial",
  note: NOTE,
  sources: [
    {
      role: "primary",
      dataset: BJD_DATASET,
      provider: "국토교통부",
      url: BJD_URL,
      license: BJD_LICENSE,
      as_of: opts["bjd-as-of"],
      retrieved: opts.retrieved,
      sha256: bjdSha,
    },
    {
      role: "cross-check",
      dataset: KG_DATASET,
      provider: KG_PROVIDER,
      url: KG_URL,
      license: KG_LICENSE,
      as_of: opts.retrieved,
      retrieved: opts.retrieved,
      sha256: kgSha,
    },
  ],
  sido,
  sigungu,
  abolished: ABOLISHED,
};

writeFileSync(opts.out, `${JSON.stringify(doc, null, 2)}\n`);
const partial = sigungu.filter((s) => s.verified === "partial").length;
const unverified = sigungu.length - partial;
process.stdout.write(
  `sido ${sido.length}, sigungu ${sigungu.length} (partial ${partial}, false ${unverified}), abolished ${ABOLISHED.length}\n`,
);
