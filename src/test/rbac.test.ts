/** RBAC контура публикаций: роль в проекте и матрица действий. */
import { describe, expect, it } from "vitest";
import { ACTION_LEVELS, canDo, resolveProjectRole, roleAllows } from "../../supabase/functions/_lib/rbac.ts";

describe("resolveProjectRole", () => {
  it("владелец — owner независимо от прочего", () => {
    expect(resolveProjectRole({ isOwner: true, globalRole: "viewer", memberRole: "viewer", isMember: true })).toBe("owner");
  });
  it("явная роль участника сильнее глобальной", () => {
    expect(resolveProjectRole({ isOwner: false, globalRole: "admin", memberRole: "operator", isMember: true })).toBe("operator");
    expect(resolveProjectRole({ isOwner: false, globalRole: "viewer", memberRole: "manager", isMember: true })).toBe("manager");
  });
  it("глобальный admin/director видит проект как admin, даже без участия", () => {
    expect(resolveProjectRole({ isOwner: false, globalRole: "admin", memberRole: null, isMember: false })).toBe("admin");
    expect(resolveProjectRole({ isOwner: false, globalRole: "director", memberRole: "member", isMember: true })).toBe("admin");
  });
  it("участник без явной роли наследует глобальную; без глобальной — manager (как до RBAC)", () => {
    expect(resolveProjectRole({ isOwner: false, globalRole: "marketer", memberRole: "member", isMember: true })).toBe("content_manager");
    expect(resolveProjectRole({ isOwner: false, globalRole: "viewer", memberRole: "member", isMember: true })).toBe("viewer");
    expect(resolveProjectRole({ isOwner: false, globalRole: null, memberRole: "member", isMember: true })).toBe("manager");
  });
  it("не участник без глобального admin — нет доступа", () => {
    expect(resolveProjectRole({ isOwner: false, globalRole: "manager", memberRole: null, isMember: false })).toBeNull();
  });
});

describe("матрица", () => {
  it("уровни вложены: viewer < operator < content_manager < manager < admin < owner", () => {
    expect(roleAllows("viewer", "read")).toBe(true);
    expect(roleAllows("viewer", "operate")).toBe(false);
    expect(roleAllows("operator", "operate")).toBe(true);
    expect(roleAllows("operator", "publish")).toBe(false);
    expect(roleAllows("content_manager", "publish")).toBe(true);
    expect(roleAllows("content_manager", "manage")).toBe(false);
    expect(roleAllows("manager", "manage")).toBe(true);
    expect(roleAllows("manager", "admin")).toBe(false);
    expect(roleAllows("admin", "admin")).toBe(true);
    expect(roleAllows("owner", "admin")).toBe(true);
  });
  it("действия: оператор повторяет задание, но не публикует; контент-менеджер публикует, но не подключает; роли — только admin", () => {
    expect(canDo("operator", "job_retry")).toBe(true);
    expect(canDo("operator", "publish_video")).toBe(false);
    expect(canDo("content_manager", "publish_video")).toBe(true);
    expect(canDo("content_manager", "connect")).toBe(false);
    expect(canDo("manager", "connect")).toBe(true);
    expect(canDo("manager", "member_role_set")).toBe(false);
    expect(canDo("admin", "member_role_set")).toBe(true);
    expect(canDo(null, "list")).toBe(false);
  });
  it("неизвестное действие требует manage", () => {
    expect(canDo("content_manager", "something_new")).toBe(false);
    expect(canDo("manager", "something_new")).toBe(true);
    expect(Object.values(ACTION_LEVELS).every((l) => ["read", "operate", "publish", "manage", "admin"].includes(l))).toBe(true);
  });
});
