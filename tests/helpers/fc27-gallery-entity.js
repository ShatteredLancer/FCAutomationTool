// Models the relevant EA constructor/factory distinction observed in compiled_2:
// raw rating/rareflag/positions map to private fields with getter-only access.
// Static data, traits and cosmetics are native objects, not JSON DTOs.
export class GalleryItemEntity {
  constructor() {
    this.definitionId = 0; this.type = 'player'; this.concept = false;
    this.stackCount = 0; this._rating = 0; this._rareflag = 0;
    this.attributes = []; this.basePossiblePositions = [];
    this._hyperCosmeticDTOs = {}; this.cosmetics = []; this.guidAssetId = '';
  }
  get rating() { return this._rating; }
  get rareflag() { return this._rareflag; }
  get possiblePositions() { return this.basePossiblePositions; }
  isPlayer() { return this.type === 'player'; }
  isValid() { return this.definitionId > 0 && this.stackCount > 0; }
  getStaticData() { return this._staticData; }
  getPlayStyles() { return this._playStyles; }
  getAuctionData() { return this._auction; }
  getFoilSubtype() { return this._hyperCosmeticDTOs[1]?.subtype ?? -1; }
}

class StaticData { constructor(name) { this.name = name; } getName() { return this.name; } }
class Trait { constructor(id) { this.id = id; } isPlus() { return true; } }
class HyperCosmetic { constructor(subtype) { this.subtype = subtype; this.staticAssetGuid = 'foil-guid'; } }

export function galleryEntityFromDto(raw) {
  const entity = new GalleryItemEntity();
  Object.assign(entity, {
    definitionId: raw.resourceId, type: raw.itemType ?? 'player', concept: raw.dream ?? true,
    stackCount: 1, _rating: raw.rating ?? 0, _rareflag: raw.rareflag ?? 0,
    attributes: raw.attributeArray ?? [], basePossiblePositions: raw.possiblePositions ?? [],
    nationId: raw.nation, teamId: raw.teamId, leagueId: raw.leagueId, owners: raw.owners,
    guidAssetId: raw.guidAssetId ?? '',
    _hyperCosmeticDTOs: Object.fromEntries(Object.entries(raw.hyperCosmetics ?? {}).map(([key, value]) => [key, new HyperCosmetic(value)])),
    _staticData: new StaticData('Player'), _playStyles: (raw.iconTraits ?? []).map(id => new Trait(id)),
    _auction: { isValid: () => !!raw.auctionValid, tradeOwner: raw.tradeOwner },
  });
  return entity;
}
