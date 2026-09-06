/**
 * Экран телефона как интерфейс: разбор разметки Android, безопасный ввод и распознавание
 * экрана после входа. Всё это чистые функции — их и проверяем, без телефона.
 */
import { describe, expect, it } from "vitest";
import {
  centerOf,
  classifyScreen,
  editFields,
  findByLabel,
  hasNonAscii,
  inputTextCommand,
  LOGIN_FLOWS,
  parseUiNodes,
  shellQuote,
} from "../../supabase/functions/_lib/phonescreen.ts";

/** Реальный срез разметки экрана входа Instagram, снятый с CP-2. */
const LOGIN_DUMP = [
  `|android.widget.Button|English (US)|false|[364,159][716,220]`,
  `|android.widget.ImageView|Instagram from Meta|false|[45,478][1035,647]`,
  `Username, email or mobile number|android.view.View|Username, email or mobile number|false|[90,1018][757,1070]`,
  `|android.widget.EditText|Username, email or mobile number,|false|[90,1037][888,1092]`,
  `Password|android.view.View|Password|false|[90,1219][280,1271]`,
  `|android.widget.EditText|Password,|true|[90,1238][888,1293]`,
  `|android.widget.Button|Log in|false|[45,1362][1035,1486]`,
].join("\n");

describe("разбор разметки экрана", () => {
  it("читает узлы со всеми полями и координатами", () => {
    const nodes = parseUiNodes(LOGIN_DUMP);
    expect(nodes).toHaveLength(7);
    expect(nodes[3]).toMatchObject({
      className: "android.widget.EditText",
      desc: "Username, email or mobile number,",
      password: false,
      bounds: { x1: 90, y1: 1037, x2: 888, y2: 1092 },
    });
  });

  it("пропускает строки без координат, а не падает на них", () => {
    expect(parseUiNodes("мусор\n|класс|||\n")).toHaveLength(0);
    expect(parseUiNodes("")).toHaveLength(0);
  });

  it("поля ввода отдаёт сверху вниз, поле пароля помечено", () => {
    const fields = editFields(parseUiNodes(LOGIN_DUMP));
    expect(fields).toHaveLength(2);
    expect(fields[0].desc).toContain("Username");
    expect(fields[1].password).toBe(true);
  });

  it("центр узла — туда и тапаем", () => {
    const [button] = parseUiNodes(`|android.widget.Button|Log in|false|[45,1362][1035,1486]`);
    expect(centerOf(button)).toEqual({ x: 540, y: 1424 });
  });

  it("ищет по подписи без учёта регистра и висящей запятой", () => {
    const nodes = parseUiNodes(LOGIN_DUMP);
    expect(findByLabel(nodes, ["log in"])?.desc).toBe("Log in");
    expect(findByLabel(nodes, LOGIN_FLOWS.instagram.userLabels)?.className).toContain("View");
    expect(findByLabel(nodes, ["ничего такого"])).toBeNull();
  });
});

describe("ввод текста на телефон", () => {
  it("одинарные кавычки не дают шеллу раскрыть пароль", () => {
    // В двойных кавычках `$USER` и обратные кавычки выполнились бы на телефоне.
    expect(inputTextCommand("p$w`id`")).toBe(`input text 'p$w\`id\`'`);
  });

  it("пробел уходит как %s — иначе `input text` обрежет строку", () => {
    expect(inputTextCommand("two words")).toBe(`input text 'two%swords'`);
  });

  it("одинарная кавычка внутри пароля экранируется", () => {
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
  });

  it("кириллицу отлавливаем заранее — Android её не наберёт", () => {
    expect(hasNonAscii("пароль")).toBe(true);
    expect(hasNonAscii("P@ssw0rd!")).toBe(false);
  });
});

describe("что на экране после входа", () => {
  const flow = LOGIN_FLOWS.instagram;

  it("форма входа — вход ещё не состоялся", () => {
    expect(classifyScreen(parseUiNodes(LOGIN_DUMP), flow).state).toBe("form");
  });

  it("неверный пароль виден по тексту площадки", () => {
    const nodes = parseUiNodes(`Incorrect password|android.view.View|Incorrect password|false|[0,0][100,100]`);
    expect(classifyScreen(nodes, flow).state).toBe("wrong_password");
  });

  it("двухфакторка важнее формы: на её экране тоже есть поле ввода", () => {
    const nodes = parseUiNodes([
      `Enter the code|android.view.View|Enter the code|false|[0,0][100,100]`,
      `|android.widget.EditText|Code,|false|[0,200][100,300]`,
    ].join("\n"));
    expect(classifyScreen(nodes, flow).state).toBe("two_factor");
  });

  it("успех — по признакам ленты", () => {
    const nodes = parseUiNodes(`Your story|android.view.View|Your story|false|[0,0][100,100]`);
    expect(classifyScreen(nodes, flow).state).toBe("success");
  });

  it("пустой экран не выдаётся за успех", () => {
    expect(classifyScreen([], flow).state).toBe("unknown");
  });
});

describe("экран после успешного входа", () => {
  const flow = { packageName: "com.instagram.android", userLabels: ["username"], passLabels: ["password"], submitLabels: ["log in"], gateLabels: [], loggedInLabels: ["your story", "home"] };

  it("вопрос «сохранить данные для входа» — это успех, а не ошибка", () => {
    // Именно на этом экране человек видел «вход не завершён», хотя аккаунт уже открыт.
    const nodes = [
      { text: "Save your login info to Instagram?", desc: "", password: false, bounds: { x1: 0, y1: 200, x2: 1000, y2: 300 } },
      { text: "Not now", desc: "", password: false, bounds: { x1: 0, y1: 900, x2: 1000, y2: 1000 } },
    ] as never;
    const v = classifyScreen(nodes, flow as never);
    expect(v.state).toBe("post_login");
    expect(v.message).toMatch(/Вход прошёл/);
  });

  it("предложение включить уведомления тоже считается входом", () => {
    const nodes = [
      { text: "Turn on Notifications", desc: "", password: false, bounds: { x1: 0, y1: 200, x2: 1000, y2: 300 } },
    ] as never;
    expect(classifyScreen(nodes, flow as never).state).toBe("post_login");
  });

  it("непонятный экран объясняет, что делать, а не просто «не распознан»", () => {
    const nodes = [{ text: "Какой-то новый экран", desc: "", password: false, bounds: { x1: 0, y1: 0, x2: 10, y2: 10 } }] as never;
    const v = classifyScreen(nodes, flow as never);
    expect(v.state).toBe("unknown");
    expect(v.message).toMatch(/Проверить вход|ленту/);
  });
});
