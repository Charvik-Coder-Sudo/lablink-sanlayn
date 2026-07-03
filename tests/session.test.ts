import { describe, expect, it } from "vitest";
import { isCompanyEmail, isPrivileged, isAdmin, highestRole } from "@/lib/session";

describe("session/domain rules", () => {
  it("accepts valid @sanlayan.com emails", () => {
    expect(isCompanyEmail("john.doe@sanlayan.com")).toBe(true);
    expect(isCompanyEmail("JOHN@Sanlayan.COM")).toBe(true);
  });
  it("rejects everything else", () => {
    expect(isCompanyEmail("john@gmail.com")).toBe(false);
    expect(isCompanyEmail("bad@sanlayan.co")).toBe(false);
    expect(isCompanyEmail("")).toBe(false);
  });
});

describe("role helpers", () => {
  it("privileged covers admin and manager", () => {
    expect(isPrivileged(["employee"])).toBe(false);
    expect(isPrivileged(["manager"])).toBe(true);
    expect(isPrivileged(["admin"])).toBe(true);
  });
  it("isAdmin only for admin", () => {
    expect(isAdmin(["manager"])).toBe(false);
    expect(isAdmin(["admin", "employee"])).toBe(true);
  });
  it("highest role priority admin > manager > employee", () => {
    expect(highestRole(["employee"])).toBe("employee");
    expect(highestRole(["manager","employee"])).toBe("manager");
    expect(highestRole(["admin","manager","employee"])).toBe("admin");
  });
});
