export class FakeElement {
  readonly tagName: string;
  readonly id: string;
  children: FakeElement[] = [];
  value = "";
  hidden = false;
  className = "";
  private text = "";
  private listeners = new Map<string, Array<() => void>>();

  constructor(tag: string, id = "") {
    this.tagName = tag.toUpperCase();
    this.id = id;
  }

  get textContent(): string {
    return this.text + this.children.map((c) => c.textContent).join("");
  }

  set textContent(v: string) {
    this.text = String(v);
    this.children = [];
  }

  append(...n: FakeElement[]): void {
    this.children.push(...n);
  }

  replaceChildren(...n: FakeElement[]): void {
    this.text = "";
    this.children = [...n];
  }

  addEventListener(type: string, fn: () => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }

  dispatch(type: string): void {
    for (const fn of this.listeners.get(type) ?? []) fn();
  }
}

/** Elements for every `id="…"` in the HTML (tag from the opening tag); `hidden` attribute honoured. */
export function fakeDocument(html: string): {
  document: { getElementById(id: string): FakeElement | null; createElement(tag: string): FakeElement };
  byId(id: string): FakeElement;
} {
  const byIdMap = new Map<string, FakeElement>();
  for (const m of html.matchAll(/<([a-z][a-z0-9]*)\b([^>]*)\bid="([^"]+)"([^>]*)>/gi)) {
    const tag = m[1] ?? "";
    const id = m[3] ?? "";
    const attrs = `${m[2] ?? ""} ${m[4] ?? ""}`;
    if (byIdMap.has(id)) continue;
    const el = new FakeElement(tag, id);
    el.hidden = /(^|\s)hidden(\s|$)/.test(attrs);
    byIdMap.set(id, el);
  }
  return {
    document: {
      getElementById(id: string): FakeElement | null {
        return byIdMap.get(id) ?? null;
      },
      createElement(tag: string): FakeElement {
        return new FakeElement(tag);
      },
    },
    byId(id: string): FakeElement {
      const el = byIdMap.get(id);
      if (!el) throw new Error("fake DOM에 요소가 없습니다: " + id);
      return el;
    },
  };
}
