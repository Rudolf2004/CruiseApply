import {expect,it} from "vitest";
import {csv,csvCell,recordKind,recordFilters,records} from "./catalog";
it("allowlists tables and excludes credentials and private content",()=>{expect(recordKind("voucher_access")).toBeNull();expect(recordKind("__proto__")).toBeNull();expect(JSON.stringify(Object.values(records).map(r=>r.columns))).not.toMatch(/pin|token|metadata|body|storage_path|personal|identification/);});
it("bounds pages and strips query filter syntax",()=>{expect(recordFilters({q:"x%,status.eq.successful",page:"-9"})).toEqual({q:"x  status eq successful",page:1,status:""});expect(recordFilters({page:"999999"}).page).toBe(10000);});
it("escapes CSV cells and neutralizes spreadsheet formulas including whitespace",()=>{for(const value of ["=SUM(1,2)"," +cmd","@SUM", "\ttext"])expect(csvCell(value).startsWith(String.fromCharCode(34,39))).toBe(true);expect(csvCell('a"b')).toBe('"a""b"');expect(csv(["v"],[{v:null}])).toBe('"v"\r\n""');});
