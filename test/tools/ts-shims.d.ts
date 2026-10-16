// Globals the editor's own page provides and the WME SDK typings do not describe.
// Declared as `any`: the script only reaches through them for the map, and the
// runtime checks for them are what the layers and recovery suites are for.
interface Window {
  OpenLayers: any;
  W?: any;
}
declare const OpenLayers: any;
declare const W: any;
