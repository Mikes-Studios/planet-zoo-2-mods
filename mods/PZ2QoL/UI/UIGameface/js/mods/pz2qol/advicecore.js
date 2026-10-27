// Why the breeding programme advises selling or keeping an animal
// (kinprogramme sellAdvice and keepAdvice give the reason): one text for
// the park's notices and the Storage window's tags. Both pages.
const ADVICE = Object.freeze({
    weak: { keep: false, why: () => "its young would score well below your best pair's, and better ones breed in its place" },
    nofert: { keep: false, why: () => 'it has a 0% fertility gene, so it never breeds' },
    below: { keep: false, why: () => 'its young would score below those of every one of its sex breeding in your groups: keeping it, even for later, brings your standard down' },
    replaced: { keep: false, why: () => 'a better one breeds in its place, and none of your young need it later' },
    elderly: { keep: false, why: () => 'it turns elderly within a year: sell it while the market still takes it' },
    young: { keep: true, why: n => `${n} young of yours grow up no kin of it while it still breeds: it can father them then, and the trade centre keeps it from ageing` },
    last: { keep: true, why: () => 'your only good one of its sex outside a group: keep it as a mate' },
});

export function adviceWhy(reason, young = 0) {
    return (ADVICE[reason] || ADVICE.weak).why(young);
}

export function adviceKeeps(reason) {
    return !!(ADVICE[reason] && ADVICE[reason].keep);
}
