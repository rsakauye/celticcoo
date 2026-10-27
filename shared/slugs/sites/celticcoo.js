// Celtic Coo profile links. Another site copies this file and edits the lists.
// The engine never imports it.

export default {
  fillers: ['the', 'of', 'and', 'a', 'an', 'city'],
  suffixPhrases: [
    ['social', 'club'],
    ['pipe', 'band'],
    ['pipes', 'and', 'drums'],
    ['pipes', 'drums'],
  ],
  suffixWords: ['society', 'association', 'club', 'inc', 'ltd', 'canada'],
  maxSlugLength: 30,
  collisionField: 'city',
  collisionSkip: ['national'],
  extraCollisionFields: ['province'],
  shortCodeLength: 4,
  alphabet: 'abcdefghjkmnpqrstuvwxyz23456789',
  shortPrefix: '/g/',
  profilePrefix: '/groups/',
  // Move a code here when its club leaves the directory. Do not mint it again.
  retiredCodes: [],
  // First batch of codes was minted with createRng(shortCodeSeed). Do not remint stored codes.
  shortCodeSeed: 20261027,
};
