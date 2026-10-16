'use strict';
/**
 * What the tests expect the script to build, and the reference values they check
 * it against.
 *
 * The EPSG:2180 numbers were computed with PROJ 9.5.1 (`pyproj` 3.7.2,
 * `Transformer.from_crs("EPSG:4326", "EPSG:2180", always_xy=True)`) and are
 * reproduced here to the millimetre; the tests compare the script's own
 * transformation against them.
 */

/** Points the suites use, WGS84 plus the PROJ answer in EPSG:2180. */
const REFERENCE_POINTS = {
  /** The level crossing at Imbramowice, the one in the round-17 report. */
  imbramowice: { lon: 16.56551, lat: 50.96977, easting: 329123.7320, northing: 347589.3861 },
  imbramowice_village: { lon: 16.56399, lat: 50.96967, easting: 329016.6896, northing: 347581.7954 },
  poznan: { lon: 16.89736, lat: 52.40058, easting: 356995.7027, northing: 505930.3885 },
  wroclaw: { lon: 17.03027, lat: 51.09890, easting: 362125.9865, northing: 360968.7925 },
  warszawa: { lon: 21.01223, lat: 52.22968, easting: 637384.3142, northing: 486755.0428 },
  krakow: { lon: 19.93733, lat: 50.06166, easting: 567069.0874, northing: 244242.7232 },
  gdansk: { lon: 18.64404, lat: 54.35601, easting: 476873.5144, northing: 721383.4019 },
  baltic: { lon: 16.34190, lat: 54.42747, easting: 327624.4169, northing: 732527.0902 },
  zakopane: { lon: 19.94900, lat: 49.29690, easting: 568977.5675, northing: 159255.8820 },
  suwalki: { lon: 22.93000, lat: 54.11100, easting: 756783.8294, northing: 701211.6397 }
};

/** The services the script's layer definitions point at. */
const SERVICES = {
  orto: 'PZGIK/ORTO/WMTS/StandardResolution',
  ortoHigh: 'PZGIK/ORTO/WMS/HighResolution',
  osm: '/OSM/BaseMap/service',
  adresy: 'KrajowaIntegracjaNumeracjiAdresowej',
  rail: '/sdi/Przejazdy/get',
  mileage: '/OSM/SiecDrogowaOSM',
  topo: 'KrajowaIntegracjaBazDanychObiektowTopograficznych',
  parcels: 'KrajowaIntegracjaEwidencjiGruntow',
  border: 'PZGIK/PRG/WMS/AdministrativeBoundaries',
  kompozycja: 'kompozycja_BDOT10k_WMS'
};

const RAIL_LAYERS = [
  'PMT_Linie_Kolejowe_Sp__z_o_o_',
  'Kopalnia_Piasku_KOTLARNIA_-_Linie_Kolejowe_Sp__z__o_o_',
  'Jastrzębska_Spółka_Kolejowa_Sp__z_o_o_',
  'Infra_SILESIA_S_A_',
  'EUROTERMINAL_Sławków_Sp__z_o_o_',
  'Dolnośląska_Służba_Dróg_i_Kolei_we_Wrocławiu',
  'CARGOTOR_Sp__z_o_o_',
  'PKP_SKM_w_Trójmieście_Sp__z_o_o_',
  'PKP_Linia_Hutnicza_Szerokotorowa_Sp__z_o__o_',
  'PKP_Polskie_Linie_Kolejowe'
].join(',');

/** What the BDOT category offers, exactly as the script's own list has it. */
const BDOT_LAYERS = {
  'BDOT - Gruntowa': 'DrDGr,DrLGr',
  'BDOT - Utwardzona': 'JDrLNUt',
  'BDOT - Twarda': 'JDLNTw,JDrZTw',
  'BDOT - Główna': 'JDrG',
  'BDOT - W budowie (Ekspr./Główna)': 'DrEk',
  'BDOT - Jezdnia (Ekspr./Główna)': 'JDrEk',
  'BDOT - Autostrada': 'JAu',
  'BDOT - Numer drogi': 'NrDr'
};

/**
 * Every layer the script builds, in the order it defines them, with the properties
 * the suites check. `kind: 'tiles'` is a WMTS/XYZ layer of the editor's own grid,
 * `kind: 'view'` a WMS layer fetchting one image per view, `kind: 'grid'` a WMS
 * layer fetchting one image per cell.
 * @type {Record<string, object>}
 */
const LAYERS = {
  'Geoportal - ortofoto': {
    kind: 'tiles', service: SERVICES.orto, category: 'Satellite / Orto',
    minZ: 0, maxZ: 19, hasOpacity: true, contrast: false
  },
  'Geoportal - ortofoto high res': {
    kind: 'grid', service: SERVICES.ortoHigh, category: 'Satellite / Orto',
    layers: 'Raster', format: 'image/jpeg', minZ: 14, singleTile: false, ratio: 1.5,
    crs: 'EPSG:4326', hasOpacity: true, contrast: false
  },
  'Geoportal - OSM': {
    kind: 'tiles', service: SERVICES.osm, category: 'Satellite / Orto',
    minZ: 0, maxZ: 19, hasOpacity: true, contrast: false, magnify: 1, rank: 1
  },
  'Geoportal - adresy': {
    kind: 'grid', service: SERVICES.adresy, category: 'Adresy i Ulice',
    layers: 'A07_Punkty_adresowe', format: 'image/png', minZ: 14, singleTile: false,
    ratio: 1.5, crs: 'EPSG:4326', hasOpacity: false, contrast: false
  },
  'Geoportal - ulice': {
    kind: 'grid', service: SERVICES.adresy, category: 'Adresy i Ulice',
    layers: 'A08_Ulice_Linie', format: 'image/png', minZ: 14, singleTile: false,
    ratio: 1.5, crs: 'EPSG:4326', hasOpacity: false, contrast: false
  },
  'Geoportal - place': {
    kind: 'grid', service: SERVICES.adresy, category: 'Adresy i Ulice',
    layers: 'A08_Ulice_Powierzchnie', format: 'image/png', minZ: 14, singleTile: false,
    ratio: 1.5, crs: 'EPSG:4326', hasOpacity: false, contrast: false
  },
  'Geoportal - adresy, place i ulice w jednym': {
    kind: 'grid', service: SERVICES.adresy, category: 'Adresy i Ulice',
    layers: 'A07_Punkty_adresowe,A08_Ulice_Powierzchnie,A08_Ulice_Linie',
    format: 'image/png', minZ: 14, singleTile: false, ratio: 1.5, crs: 'EPSG:4326',
    hasOpacity: false, contrast: false
  },
  'Geoportal - przejazdy kolejowe (wymagany duży zoom)': {
    kind: 'grid', service: SERVICES.rail, category: 'Topografia / Inne',
    layers: RAIL_LAYERS, format: 'image/png', minZ: 15, singleTile: false, ratio: 1.5,
    crs: 'EPSG:2180', hasOpacity: false, contrast: 'dark'
  },
  'Geoportal - drogi': {
    kind: 'view', service: SERVICES.mileage, category: 'Topografia / Inne',
    layers: 'planowane,wbudowie,pikietaz,drugorzedne,glowne,ekspresowe,autostrady',
    format: 'image/png', minZ: 12, singleTile: true, ratio: 1.5, crs: 'EPSG:4326',
    hasOpacity: false, contrast: 'dark'
  },
  'Geoportal - podział adm': {
    kind: 'grid', service: SERVICES.parcels, category: 'Podział Administracyjny',
    layers: 'dzialki,numery_dzialek', format: 'image/png', minZ: 15, singleTile: false,
    ratio: 1.5, crs: 'EPSG:4326', hasOpacity: false, contrast: 'colour'
  },
  'Geoportal - Miasta': {
    kind: 'grid', service: SERVICES.border, category: 'Podział Administracyjny',
    layers: 'A06_Granice_obrebow_ewidencyjnych,A05_Granice_jednostek_ewidencyjnych,A04_Granice_miast',
    format: 'image/png', minZ: 12, singleTile: false, ratio: 1.5, crs: 'EPSG:4326',
    hasOpacity: false, contrast: 'colour'
  },
  'Geoportal - gminy': {
    kind: 'grid', service: SERVICES.border, category: 'Podział Administracyjny',
    layers: 'A03_Granice_gmin', format: 'image/png', minZ: 10, singleTile: false,
    ratio: 1.5, crs: 'EPSG:4326', hasOpacity: false, contrast: 'colour'
  },
  'Geoportal - powiaty': {
    kind: 'grid', service: SERVICES.border, category: 'Podział Administracyjny',
    layers: 'A02_Granice_powiatow', format: 'image/png', minZ: 10, singleTile: false,
    ratio: 1.5, crs: 'EPSG:4326', hasOpacity: false, contrast: 'colour'
  },
  'Geoportal - województwa': {
    kind: 'grid', service: SERVICES.border, category: 'Podział Administracyjny',
    layers: 'A01_Granice_wojewodztw', format: 'image/png', minZ: 8, singleTile: false,
    ratio: 1.5, crs: 'EPSG:4326', hasOpacity: false, contrast: 'colour'
  },
  'Geoportal - Granica PL': {
    kind: 'grid', service: SERVICES.border, category: 'Podział Administracyjny',
    layers: 'A00_Granice_panstwa', format: 'image/png', minZ: 0, singleTile: false,
    ratio: 1.5, crs: 'EPSG:4326', hasOpacity: false, contrast: 'colour'
  },
  'Geoportal - obiekty topograficzne': {
    kind: 'grid', service: SERVICES.topo, category: 'Topografia / Inne',
    layers: 'bdot', format: 'image/png', minZ: 16, singleTile: false, ratio: 1.5,
    crs: 'EPSG:2180', hasOpacity: false, contrast: 'dark'
  }
};

for (const [name, classNames] of Object.entries(BDOT_LAYERS)) {
  LAYERS[name] = {
    kind: 'view', service: SERVICES.kompozycja, category: 'BDOT (Szczegółowa)',
    layers: classNames, format: 'image/png', minZ: 16, singleTile: true, ratio: 1,
    crs: 'EPSG:2180', hasOpacity: false, contrast: 'colour'
  };
}

/** The layer names in the order the script defines them (this is also the z-index order). */
const LAYER_ORDER = Object.keys(LAYERS);

/** The categories, in menu order, with the layers under each. */
const CATEGORIES = {
  'Satellite / Orto': ['Geoportal - ortofoto', 'Geoportal - ortofoto high res', 'Geoportal - OSM'],
  'Adresy i Ulice': [
    'Geoportal - adresy', 'Geoportal - ulice', 'Geoportal - place',
    'Geoportal - adresy, place i ulice w jednym'
  ],
  'Podział Administracyjny': [
    'Geoportal - podział adm', 'Geoportal - Miasta', 'Geoportal - gminy',
    'Geoportal - powiaty', 'Geoportal - województwa', 'Geoportal - Granica PL'
  ],
  'Topografia / Inne': [
    'Geoportal - drogi', 'Geoportal - przejazdy kolejowe (wymagany duży zoom)',
    'Geoportal - obiekty topograficzne'
  ],
  'BDOT (Szczegółowa)': Object.keys(BDOT_LAYERS)
};

/** The sentences the round-16 report asked to be gone from under the layer list. */
const REMOVED_HINTS = [
  'Przesunięcie suwaka przezroczystości w prawo włącza warstwę.',
  'Warstwa ukrywa się automatycznie przy małym przybliżeniu.'
];

module.exports = {
  REFERENCE_POINTS, SERVICES, RAIL_LAYERS, BDOT_LAYERS,
  LAYERS, LAYER_ORDER, CATEGORIES, REMOVED_HINTS
};
