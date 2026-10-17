import { describe, expect, it } from "vitest";
import { draftSchema, emptyDraft, questionSchema, submissionSchema } from "./schema";
const valid = { ...emptyDraft, personal: { first_name: "Test",middle_name: "",surname: "Applicant",date_of_birth: "1995-01-01",nationality: "Ghanaian",country_of_residence: "Ghana",email: "test@example.com",phone: "+233123456789",address: "Test address" } };
describe("draft and final validation", () => {
  it("permits incomplete drafts but not incomplete submission", () => {
    expect(draftSchema.safeParse(emptyDraft).success).toBe(true);
    expect(submissionSchema([],null).safeParse(emptyDraft).success).toBe(false);
    expect(submissionSchema([],null).safeParse(valid).success).toBe(true);
  });
  it("rejects reversed dates and invalid calendar dates even in drafts", () => {
    const education = [{ institution: "",qualification: "",field: "",country: "",start_date: "2025-01-01",completion_date: "2024-01-01" }];
    expect(draftSchema.safeParse({ ...emptyDraft,education }).success).toBe(false);
    expect(draftSchema.safeParse({ ...emptyDraft,personal: { ...emptyDraft.personal,date_of_birth: "2020-02-31" } }).success).toBe(false);
  });
  it("enforces required questions and configured age, without inventing mandatory education", () => {
    const schema = submissionSchema([{ id: "q1",label: "Availability",required: true }],18,new Date("2026-09-29T00:00:00Z"));
    expect(schema.safeParse(valid).success).toBe(false);
    expect(schema.safeParse({ ...valid,answers: { q1: "Available" } }).success).toBe(true);
    expect(schema.safeParse({ ...valid,answers: { q1: "Available" },personal: { ...valid.personal,date_of_birth: "2008-09-30" } }).success).toBe(false);
  });
  it("requires passport fields only when availability is asserted", () => {
    expect(submissionSchema([],null).safeParse({ ...valid,identification: { ...emptyDraft.identification,passport_available: true } }).success).toBe(false);
  });
  it("rejects duplicate question IDs and whitespace-only personal details", () => {
    expect(questionSchema.safeParse([{ id: "same",label: "One" },{ id: "same",label: "Two" }]).success).toBe(false);
    expect(submissionSchema([],null).safeParse({ ...valid,personal: { ...valid.personal,first_name: " " } }).success).toBe(false);
  });
});
