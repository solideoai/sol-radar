const approvedPersonId = /^SOL-P(?:00(?:0[1-9]|[1-9]\d)|01\d\d|0200)$/;

export function demoPortraitPath(personId: string | null | undefined): string | null {
  return typeof personId === "string" && personId.length === 9 && approvedPersonId.test(personId)
    ? `/demo/people/${personId}.png`
    : null;
}
