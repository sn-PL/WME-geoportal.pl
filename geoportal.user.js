// ==UserScript==
// @name            Geoportal Waze integration (fork by snPL)
// @version         1.5.3
// @description     Adds geoportal.gov.pl overlays ("satellite view", house numbers, cities names) to WME (API March 2026)
// @include         https://*.waze.com/*/editor*
// @include         https://*.waze.com/editor*
// @include         https://*.waze.com/map-editor*
// @include         https://*.waze.com/beta_editor*
// @copyright       2013-2026+, Patryk Ściborek, Paweł Pyrczak, Kamil Marud, snPL, sledzik1984
// @run-at          document-end
// @grant           none
// @license         MIT
// @icon            https://www.google.com/s2/favicons?sz=64&domain=geoportal.gov.pl
// @namespace       https://github.com/med-zz-eis/WME-geoportal.pl
// @downloadURL     https://update.greasyfork.org/scripts/572377/Geoportal%20Waze%20integration%20%28fork%20by%20snPL%29.user.js
// @updateURL       https://update.greasyfork.org/scripts/572377/Geoportal%20Waze%20integration%20%28fork%20by%20snPL%29.meta.js
// ==/UserScript==

/**
 * Credits:
 * This script is based on "geoportal.gov.pl layers for WME without translating PROXY" by Paweł Pyrczak
 * and Strah's (https://github.com/strah/WME-geoportal.pl) and Kamil Marud (https://github.com/kmarud/WME-geoportal.pl) adjustments.
 */

/* Changelog:
 *  1.5.2 - New layer names address, streets WMS endpoint
 *  1.5.1 - Allow selective opacity sliders (checkbox-only for boundaries/addresses).
 *  1.5.0 - Release (WME March 2026 API Update):
 *          - Complete refactor into ES6 Classes.
 *          - Full support for WME's new modular "Draggable Cards" UI.
 *          - Added MutationObserver for stable UI persistence.
 *          - Added opacity sliders with auto-enable/disable logic.
 *          - Implemented lazy loading and zoom-level filtering for performance.
 *          - Full compatibility with WME Dark Theme.
 *  1.4.3 - Fix issue with checkboxes logic.
 *  1.4.2 - Fix map update and layer switching issues.
 *  1.4.1 - Fix orto resolution issues.
 *  1.4.0 - Add BDOT10k layers.
 *  1.3.1 - Update WMS service URLs.
 *  1.2.0 - Add administrative boundaries layers.
 *  1.1.0 - Add parcels and addresses layers.
 */

(function () {
  'use strict';

  class GeoportalIntegration {
    constructor() {
      this.ver = "1.5.1";
      this.layers = {};
      this.settingsKey = 'wme_geoportal_settings';
      this.settings = this.loadSettings();
      this.uiInjected = false;

      this.WMS_SERVICES = {
        orto: "https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMS/StandardResolution?",
        orto_high: "https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMS/HighResolution?",
        osm: "https://mapy.geoportal.gov.pl/wss/ext/OSM/BaseMap/service?",
        adresy: "https://mapy.geoportal.gov.pl/wss/ext/KrajowaIntegracjaNumeracjiAdresowej?request=GetMap&",
        rail: "https://mapy.geoportal.gov.pl/wss/service/sdi/Przejazdy/get?REQUEST=GetMap&",
        mileage: "https://mapy.geoportal.gov.pl/wss/ext/OSM/SiecDrogowaOSM?",
        topo: "https://integracja.gugik.gov.pl/cgi-bin/KrajowaIntegracjaBazDanychObiektowTopograficznych?",
        parcels: "https://integracja.gugik.gov.pl/cgi-bin/KrajowaIntegracjaEwidencjiGruntow?",
        border_city: "https://mapy.geoportal.gov.pl/wss/service/PZGIK/PRG/WMS/AdministrativeBoundaries?REQUEST=GetMap&",
        kompozycja: "https://mapy.geoportal.gov.pl/wss/service/pub/guest/kompozycja_BDOT10k_WMS/MapServer/WMSServer"
      };

      this.CATEGORIES = {
        "Satellite / Orto": ["Geoportal - ortofoto", "Geoportal - ortofoto high res", "Geoportal - OSM"],
        "Adresy i Ulice": ["Geoportal - adresy", "Geoportal - ulice", "Geoportal - place", "Geoportal - adresy, place i ulice w jednym"],
        "Podział Administracyjny": ["Geoportal - podział adm", "Geoportal - Miasta", "Geoportal - gminy", "Geoportal - powiaty", "Geoportal - województwa", "Geoportal - Granica PL"],
        "Topografia / Inne": ["Geoportal - drogi", "Geoportal - przejazdy kolejowe (wymagany duży zoom)", "Geoportal - obiekty topograficzne"],
        "BDOT (Szczegółowa)": [
          "BDOT - Gruntowa", "BDOT - Utwardzona", "BDOT - Twarda", "BDOT - Główna",
          "BDOT - W budowie (Ekspr./Główna)", "BDOT - Jezdnia (Ekspr./Główna)",
          "BDOT - Autostrada", "BDOT - Numer drogi"
        ]
      };

      this.epsg900913 = new window.OpenLayers.Projection("EPSG:900913");
      this.epsg4326 = new window.OpenLayers.Projection("EPSG:4326");

      this.init();
    }

    log(msg) {
      console.log(`%c[Geoportal] ${msg}`, 'color: #00aaff; font-weight: bold;');
    }

    loadSettings() {
      const saved = localStorage.getItem(this.settingsKey);
      const defaults = {
        enabledLayers: { "Geoportal - adresy": true },
        layerOpacity: {},
        collapsedCats: {}
      };
      const settings = saved ? JSON.parse(saved) : defaults;
      settings.enabledLayers = settings.enabledLayers || {};
      settings.layerOpacity = settings.layerOpacity || {};
      settings.collapsedCats = settings.collapsedCats || {};
      return settings;
    }

    saveSettings() {
      const enabledLayers = {};
      const layerOpacity = {};
      Object.keys(this.layers).forEach(name => {
        enabledLayers[name] = this.layers[name].isEnabled;
        layerOpacity[name] = this.layers[name].opacity;
      });
      this.settings.enabledLayers = enabledLayers;
      this.settings.layerOpacity = layerOpacity;
      localStorage.setItem(this.settingsKey, JSON.stringify(this.settings));
    }

    init() {
      this.log(`Version ${this.ver} initialization started`);
      this.bootstrap();
    }

    bootstrap(retries = 0) {
      if (retries > 60) {
        this.log("WME failed to initialize in a reasonable time.");
        return;
      }

      const W = window.W;
      if (typeof W === 'undefined' || !W.map || !W.loginManager || !W.loginManager.user || !document.querySelector('#layer-switcher-region')) {
        setTimeout(() => this.bootstrap(retries + 1), 1000);
        return;
      }

      this.setupUI();
      this.createLayersDefinition();
      this.injectUI();
      this.startZIndexMonitor();
      this.startMutationObserver();
    }

    setupUI() {
      if (document.getElementById('geoportal-styles')) return;
      const style = document.createElement('style');
      style.id = 'geoportal-styles';
      style.innerHTML = `
                #geoportal-layers-group {
                    color: inherit;
                    --geoportal-item-bg: rgba(128, 128, 128, 0.05);
                }
                #geoportal-layers-group .geoportal-separator {
                    border-top: 1px solid rgba(128, 128, 128, 0.2);
                    margin: 12px 0 8px 0;
                    padding-top: 6px;
                    font-weight: bold;
                    font-size: 0.95em;
                    color: #00aaff;
                    text-align: center;
                }
                .geoportal-category { margin-bottom: 6px; }
                .geoportal-cat-header {
                    background: var(--geoportal-item-bg);
                    padding: 8px 12px;
                    cursor: pointer;
                    font-size: 0.9em;
                    font-weight: 600;
                    border-radius: 6px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    transition: background 0.2s;
                }
                .geoportal-cat-header:hover { background: rgba(128, 128, 128, 0.15); }
                .geoportal-cat-header::after { content: '▼'; font-size: 0.75em; transition: transform 0.2s; }
                .geoportal-cat-header.collapsed::after { transform: rotate(-90deg); }
                .geoportal-cat-body { padding: 4px 0 4px 8px; overflow: hidden; transition: max-height 0.3s ease; }
                .geoportal-cat-body.collapsed { max-height: 0; display: block!important; }
                
                .geoportal-layer-item { padding: 8px 0; border-bottom: 1px solid rgba(128, 128, 128, 0.05); }
                .geoportal-layer-control { display: flex; flex-direction: column; gap: 4px; }
                
                .geoportal-slider-container {
                    padding-left: 28px;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }
                .geoportal-opacity-slider {
                    flex: 1;
                    height: 4px;
                    accent-color: #00aaff;
                    cursor: pointer;
                    opacity: 0.7;
                    transition: opacity 0.2s;
                    margin: 0;
                }
                .geoportal-opacity-slider:hover { opacity: 1; }
                .geoportal-opacity-value { font-size: 10px; color: #888; width: 22px; text-align: right; }
                
                .geoportal-info {
                    font-size: 0.75em;
                    color: #888;
                    font-style: italic;
                    margin-top: 12px;
                    padding: 0 4px;
                    line-height: 1.3;
                }
            `;
      document.head.appendChild(style);
    }

    createLayersDefinition() {
      const usrRank = window.W.loginManager.user.getRank();

      this.createWMSLayer("Geoportal - ortofoto", this.WMS_SERVICES.orto, "Raster", "image/jpeg", { singleTile: false, minZ: 0 });
      this.createWMSLayer("Geoportal - ortofoto high res", this.WMS_SERVICES.orto_high, "Raster", "image/jpeg", { singleTile: false, minZ: 14 });

      if (usrRank >= 1) {
        this.createWMSLayer("Geoportal - OSM", this.WMS_SERVICES.osm, "osm", "image/png");
      }

      this.createWMSLayer("Geoportal - adresy", this.WMS_SERVICES.adresy, "A07_Punkty_adresowe", "image/png", { singleTile: false, minZ: 14, hasOpacity: false });
      this.createWMSLayer("Geoportal - ulice", this.WMS_SERVICES.adresy, "A08_Ulice_Linie", "image/png", { singleTile: false, minZ: 14, hasOpacity: false });
      this.createWMSLayer("Geoportal - place", this.WMS_SERVICES.adresy, "A08_Ulice_Powierzchnie", "image/png", { singleTile: false, minZ: 14, hasOpacity: false });
      this.createWMSLayer("Geoportal - adresy, place i ulice w jednym", this.WMS_SERVICES.adresy, "A07_Punkty_adresowe,A08_Ulice_Powierzchnie,A08_Ulice_Linie", "image/png", { singleTile: false, minZ: 14, hasOpacity: false });

      this.createWMSLayer("Geoportal - przejazdy kolejowe (wymagany duży zoom)", this.WMS_SERVICES.rail, "PMT_Linie_Kolejowe_Sp__z_o_o_,Kopalnia_Piasku_KOTLARNIA_-_Linie_Kolejowe_Sp__z__o_o_,Jastrzębska_Spółka_Kolejowa_Sp__z_o_o_,Infra_SILESIA_S_A_,EUROTERMINAL_Sławków_Sp__z_o_o_,Dolnośląska_Służba_Dróg_i_Kolei_we_Wrocławiu,CARGOTOR_Sp__z_o_o_,PKP_SKM_w_Trójmieście_Sp__z_o_o_,PKP_Linia_Hutnicza_Szerokotorowa_Sp__z_o__o_,PKP_Polskie_Linie_Kolejowe", "image/png", { minZ: 15 });
      this.createWMSLayer("Geoportal - drogi", this.WMS_SERVICES.mileage, "planowane,wbudowie,pikietaz,drugorzedne,glowne,ekspresowe,autostrady", "image/png", { minZ: 12 });
      this.createWMSLayer("Geoportal - podział adm", this.WMS_SERVICES.parcels, "dzialki,numery_dzialek", "image/png", { singleTile: false, minZ: 15, hasOpacity: false });

      this.createWMSLayer("Geoportal - Miasta", this.WMS_SERVICES.border_city, "A06_Granice_obrebow_ewidencyjnych,A05_Granice_jednostek_ewidencyjnych,A04_Granice_miast", "image/png", { singleTile: false,  minZ: 12, hasOpacity: false });
      this.createWMSLayer("Geoportal - gminy", this.WMS_SERVICES.border_city, "A03_Granice_gmin", "image/png", { singleTile: false, minZ: 10, hasOpacity: false });
      this.createWMSLayer("Geoportal - powiaty", this.WMS_SERVICES.border_city, "A02_Granice_powiatow", "image/png", { singleTile: false, minZ: 10, hasOpacity: false });
      this.createWMSLayer("Geoportal - województwa", this.WMS_SERVICES.border_city, "A01_Granice_wojewodztw", "image/png", { singleTile: false, minZ: 8, hasOpacity: false });
      this.createWMSLayer("Geoportal - Granica PL", this.WMS_SERVICES.border_city, "A00_Granice_panstwa", "image/png", { singleTile: false, minZ: 0, hasOpacity: false });

      this.createWMSLayer("Geoportal - obiekty topograficzne", this.WMS_SERVICES.topo, "bdot", "image/png", { singleTile: false, minZ: 16 });

      const bdotMap = {
        "BDOT - Gruntowa": "DrDGr,DrLGr",
        "BDOT - Utwardzona": "JDrLNUt",
        "BDOT - Twarda": "JDLNTw,JDrZTw",
        "BDOT - Główna": "JDrG",
        "BDOT - W budowie (Ekspr./Główna)": "DrEk",
        "BDOT - Jezdnia (Ekspr./Główna)": "JDrEk",
        "BDOT - Autostrada": "JAu",
        "BDOT - Numer drogi": "NrDr"
      };

      Object.entries(bdotMap).forEach(([name, sub]) => {
        this.createWMSLayer(name, this.WMS_SERVICES.kompozycja, sub, "image/png", { minZ: 16 });
      });
    }

    createWMSLayer(name, url, layers, format = "image/png", options = {}) {
      const self = this;
      const getUrlAsEpsg4326 = function (bounds) {
        const currentZoom = window.W.map.getZoom();
        if (options.minZ !== undefined && currentZoom < options.minZ) return null;
        bounds = bounds.clone();
        bounds = this.adjustBounds(bounds);
        const imageSize = this.getImageSize(bounds);
        bounds.transform(self.epsg900913, self.epsg4326);
        const newParams = { BBOX: bounds.toArray(true), WIDTH: imageSize.w, HEIGHT: imageSize.h };
        return this.getFullRequestString(newParams);
      };
      const setEpsg4326 = function (newParams) {
        this.params.CRS = "EPSG:4326";
        return window.OpenLayers.Layer.Grid.prototype.getFullRequestString.apply(this, arguments);
      };
      this.layers[name] = {
        definition: { name, url, layers, format, options },
        hasOpacity: options.hasOpacity !== false,
        instance: null,
        opacity: this.settings.layerOpacity[name] ?? 1.0,
        isEnabled: this.settings.enabledLayers[name] ?? false,
        getInstance: function () {
          if (!this.instance) {
            this.instance = new window.OpenLayers.Layer.WMS(
              name, url,
              { layers, transparent: "true", format, version: "1.3.0" },
              {
                isBaseLayer: false, visibility: false,
                singleTile: options.singleTile ?? true,
                transitionEffect: "resize",
                getURL: getUrlAsEpsg4326,
		maxGetUrlRetries: 5,
                getFullRequestString: setEpsg4326
              }
            );
            this.instance.setOpacity(this.opacity);
            window.W.map.addLayer(this.instance);
          }
          return this.instance;
        },
        setVisibility: function (visible) {
          this.isEnabled = visible;
          if (visible) {
            this.getInstance().setVisibility(true);
          } else if (this.instance) {
            this.instance.setVisibility(false);
          }
        },
        setOpacity: function (val) {
          this.opacity = val;
          if (this.instance) this.instance.setOpacity(val);
        },
        getVisibility: function () { return this.isEnabled; }
      };
    }

    injectUI() {
      let list = document.querySelector('#layer-switcher-region .menu .list-unstyled') ||
        document.querySelector('.layer-switcher .menu .list-unstyled') ||
        document.querySelector('#sidepanel-layers .menu .list-unstyled');
      if (!list) return;

      let groupLi = document.getElementById('geoportal-layers-group');
      if (groupLi) {
        if (this.uiInjected) return;
        groupLi.innerHTML = '';
      } else {
        groupLi = document.createElement('li');
        groupLi.id = 'geoportal-layers-group';
        groupLi.className = 'group';
        list.appendChild(groupLi);
      }

      const header = document.createElement('div');
      header.className = 'geoportal-separator';
      header.innerText = "-- Geoportal PL --";
      groupLi.appendChild(header);

      Object.entries(this.CATEGORIES).forEach(([catName, layerNames]) => {
        const catDiv = document.createElement('div');
        catDiv.className = 'geoportal-category';
        const catHeader = document.createElement('div');
        catHeader.className = 'geoportal-cat-header';
        const isCollapsed = this.settings.collapsedCats[catName] === true;
        if (isCollapsed) catHeader.classList.add('collapsed');
        catHeader.innerText = catName;
        const catBody = document.createElement('div');
        catBody.className = 'geoportal-cat-body';
        if (isCollapsed) catBody.classList.add('collapsed');
        catHeader.addEventListener('click', () => {
          const nowCollapsed = catBody.classList.toggle('collapsed');
          catHeader.classList.toggle('collapsed');
          this.settings.collapsedCats[catName] = nowCollapsed;
          localStorage.setItem(this.settingsKey, JSON.stringify(this.settings));
        });
        layerNames.forEach(lName => {
          if (this.layers[lName]) catBody.appendChild(this.createUIItem(lName));
        });
        catDiv.appendChild(catHeader);
        catDiv.appendChild(catBody);
        groupLi.appendChild(catDiv);
      });

      Object.keys(this.layers).forEach(name => {
        if (this.layers[name].isEnabled) this.layers[name].setVisibility(true);
      });

      const info = document.createElement('div');
      info.className = 'geoportal-info';
      info.innerText = "Increasing opacity enables the layer.\nHides automatically at low zoom.";
      groupLi.appendChild(info);
      this.uiInjected = true;
    }

    createUIItem(lName) {
      const lData = this.layers[lName];
      const item = document.createElement('div');
      item.className = 'geoportal-layer-item';
      const control = document.createElement('div');
      control.className = 'geoportal-layer-control';
      const checkbox = document.createElement('wz-checkbox');
      checkbox.appendChild(document.createTextNode(lName));
      checkbox.checked = lData.isEnabled;
      checkbox.addEventListener('change', (e) => {
        lData.setVisibility(e.target.checked);
        this.saveSettings();
      });
      control.appendChild(checkbox);
      if (lData.hasOpacity) {
        const sliderContainer = document.createElement('div');
        sliderContainer.className = 'geoportal-slider-container';
        const slider = document.createElement('input');
        slider.type = 'range'; slider.className = 'geoportal-opacity-slider';
        slider.min = "0"; slider.max = "100";
        slider.value = (lData.opacity * 100).toString();
        const opacityVal = document.createElement('span');
        opacityVal.className = 'geoportal-opacity-value';
        opacityVal.innerText = (Math.round(lData.opacity * 100)).toString() + "%";
        slider.addEventListener('input', (e) => {
          const val = parseInt(e.target.value) / 100;
          lData.setOpacity(val);
          opacityVal.innerText = e.target.value + "%";
          if (val > 0 && !lData.isEnabled) {
            checkbox.checked = true; lData.setVisibility(true); this.saveSettings();
          } else if (val === 0 && lData.isEnabled) {
            checkbox.checked = false; lData.setVisibility(false); this.saveSettings();
          }
        });
        slider.addEventListener('change', () => this.saveSettings());
        sliderContainer.appendChild(slider); sliderContainer.appendChild(opacityVal);
        control.appendChild(sliderContainer);
      }
      item.appendChild(control); return item;
    }

    startZIndexMonitor() {
      const fixZIndex = () => {
        Object.values(this.layers).forEach(lData => {
          if (lData.instance && lData.isEnabled) lData.instance.setZIndex(2050);
        });
      };
      const throttled = window._ ? window._.throttle(fixZIndex, 1000) : fixZIndex;
      window.W.map.events.register("moveend", window.W.map, throttled);
      window.W.map.events.register("changelayer", window.W.map, throttled);
      setInterval(fixZIndex, 5000);
    }

    startZIndexMonitor() {
      const fixZIndex = () => {
        let currentZIndex = 2040; // Bazowa wartość z-index
        Object.values(this.layers).forEach(lData => {
          if (lData.instance && lData.isEnabled) {
            // Każda kolejna warstwa zyskuje wyższy z-index
            lData.instance.setZIndex(currentZIndex++);
          }
        });
      };
      const throttled = window._ ? window._.throttle(fixZIndex, 1000) : fixZIndex;
      window.W.map.events.register("moveend", window.W.map, throttled);
      window.W.map.events.register("changelayer", window.W.map, throttled);
      setInterval(fixZIndex, 5000);
    }


    startMutationObserver() {
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type === 'childList') {
            const list = document.querySelector('#layer-switcher-region .menu .list-unstyled') ||
              document.querySelector('.layer-switcher .menu .list-unstyled') ||
              document.querySelector('#sidepanel-layers .menu .list-unstyled');
            if (list && !document.getElementById('geoportal-layers-group')) {
              this.uiInjected = false; this.injectUI();
            }
          }
        }
      });
      const container = document.querySelector('#layer-switcher-region') || document.querySelector('.layer-switcher');
      if (container) observer.observe(container, { childList: true, subtree: true });
    }
  }

  new GeoportalIntegration();
})();
