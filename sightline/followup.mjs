/**
 * Decide whether the caller wants a new camera look vs a question about
 * the last thing Argo already read (no on-screen text required).
 * @param {string} userBits
 * @param {string} lastReadText
 */
export function wantsFreshLook(userBits, lastReadText) {
  if (!lastReadText) return true;
  const u = String(userBits || '').trim();
  if (!u) return true;
  if (
    /look again|read again|read (this|it|that)|what (do you|can you) see|what('s| is) (this|that|on)|new (menu|one|label)|hold (it |the )?(closer|steady)|try again/i.test(
      u,
    )
  ) {
    return true;
  }
  if (
    /how much|price|cost|total|any |vegetarian|vegan|peanut|allergen|gluten|under |cheapest|expensive|iced|latte|dose|expir|ingredient|what about|does it|is there|who|from|address/i.test(
      u,
    )
  ) {
    return false;
  }
  if (/read|see|look|camera|menu|label|sign|bottle|box|letter|mail|dial/i.test(u)) return true;
  return false;
}
