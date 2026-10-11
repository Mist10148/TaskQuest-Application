import { describe, expect, it } from "vitest";
import { pushStatus, urlBase64ToUint8Array } from "./push";

describe("urlBase64ToUint8Array", () => {
  it("decodes base64url with and without padding", () => {
    expect(Array.from(urlBase64ToUint8Array("AQID"))).toEqual([1, 2, 3]);
    expect(Array.from(urlBase64ToUint8Array("AQI"))).toEqual([1, 2]);
    // "-" and "_" are the url-safe forms of "+" and "/"
    expect(Array.from(urlBase64ToUint8Array("-_8"))).toEqual([251, 255]);
  });

  it("decodes a 65-byte VAPID public key", () => {
    const key = btoa(String.fromCharCode(...new Uint8Array(65).fill(4))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(urlBase64ToUint8Array(key)).toHaveLength(65);
  });
});

describe("pushStatus", () => {
  const base = { supported: true, serverEnabled: true, permission: "default" as const, subscribed: false };

  it("explains why push cannot be turned on, most fundamental reason first", () => {
    expect(pushStatus({ ...base, supported: false, serverEnabled: false })).toBe("unsupported");
    expect(pushStatus({ ...base, serverEnabled: false })).toBe("server-off");
    expect(pushStatus({ ...base, permission: "denied" })).toBe("denied");
    expect(pushStatus({ ...base, permission: "denied", subscribed: true })).toBe("denied");
  });

  it("is on only with a subscription and granted permission", () => {
    expect(pushStatus({ ...base, permission: "granted", subscribed: true })).toBe("on");
    expect(pushStatus({ ...base, permission: "granted", subscribed: false })).toBe("off");
    expect(pushStatus({ ...base, subscribed: true })).toBe("off");
    expect(pushStatus(base)).toBe("off");
  });
});
