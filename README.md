# geoportal.gov.pl layers for WME (WME SDK)

Skrypt wyświetla warstwy z Geoportalu w edytorze Waze. Wyświetlane warstwy to: ortofotomapa ("podkład satelitarny"), numery domów i nazwy miejscowości. Wersja 1.5.4 (2026-10-14) korzysta z oficjalnego WME SDK do inicjalizacji, odczytu stanu edytora i obsługi zdarzeń. Zachowuje dotychczasowy wygląd i położenie kontrolek w menu Warstwy.

Skrypt jest zbudowany na podstawie skryptu [geoportal.gov.pl layers for WME without translating PROXY](https://greasyfork.org/en/scripts/10611-geoportal-gov-pl-layers-for-wme-without-translating-proxy) autorstwa [Pawła Pyrczaka](https://greasyfork.org/en/users/9996-pawe%C5%82-pyrczak) oraz poprawek Stracha https://github.com/strah/WME-geoportal.pl oraz Kamila Maruda https://github.com/kmarud/WME-geoportal.pl

**Instalacja:** https://greasyfork.org/en/scripts/572377-geoportal-waze-integration-fork-by-snpl  

Pliki źródłowe są dostępne na [Githubie](https://github.com/med-zz-eis/WME-geoportal.pl), zapraszam do forkowania/aktualizacji.
---

The script displays Geoportal overlays in the WME ("satellite view", house numbers, cities names). Version 1.5.4 (2026-10-14) uses the official WME SDK for initialization, editor state, and events. The existing appearance and location of the controls in the Layers menu are retained.

This script is based on [geoportal.gov.pl layers for WME without translating PROXY](https://greasyfork.org/en/scripts/10611-geoportal-gov-pl-layers-for-wme-without-translating-proxy) script by [Paweł Pyrczak](https://greasyfork.org/en/users/9996-pawe%C5%82-pyrczak) and Strah's adjustments https://github.com/strah/WME-geoportal.pl and Kamil Marud https://github.com/kmarud/WME-geoportal.pl

**Installation:** https://greasyfork.org/en/scripts/572377-geoportal-waze-integration-fork-by-snpl

The source file is hosted on [Github](https://github.com/med-zz-eis/WME-geoportal.pl), feel free to fork/update.

---

## Jak używać / How to use

1. **Instalacja / Installation**: Zainstaluj skrypt za pomocą menedżera skryptów (np. Tampermonkey).
2. **Uruchomienie / Startup**: Otwórz Waze Map Editor.
3. **Warstwy / Layers**: W bocznym panelu "Warstwy" (pojawiającym się jako nowa karta) znajdziesz sekcję **"-- Geoportal PL --"**.
4. **Włączanie / Toggling**: Kliknij checkbox lub po prostu przesuń suwak przezroczystości w prawo. Zmiana suwaka automatycznie aktywuje warstwę.
5. **Przezroczystość / Opacity**: Ustawienie suwaka na 0% automatycznie wyłącza warstwę.
6. **Kategorie / Categories**: Warstwy są pogrupowane w zwijane kategorie (Ortofoto, Adresy, Podział Adm, BDOT).

## Zgodność z WME / WME compatibility

**PL:** Skrypt czeka na `SDK_INITIALIZED` i gotowość edytora oraz sprawdza wymagane metody SDK. Nie korzysta już z prywatnych API `W.loginManager`, `W.map.getZoom`, `W.map.events` ani globalnego Lodash. Zachowuje dotychczasowe warstwy, adresy usług WMS, kategorie, checkboxy WME, suwaki i zapisane ustawienia. Obserwator przywraca te same kontrolki po ponownym utworzeniu karty Warstwy. Warstwy są tworzone dopiero po włączeniu i osiągnięciu wymaganego poziomu przybliżenia.

**EN:** The script waits for `SDK_INITIALIZED` and editor readiness and checks required SDK methods. It no longer uses the private `W.loginManager`, `W.map.getZoom`, `W.map.events` APIs or global Lodash. Existing layers, WMS endpoints, categories, WME checkboxes, sliders and saved settings are retained. An observer reattaches the same controls when WME recreates the Layers card. Layers are created only when enabled and at the required zoom level.

**Ograniczenia / Limitations:** Dołączone typy SDK (`wme-sdk-typings.tgz`, `v2.374-5-g0024d1fa65`) opisują kafelki XYZ, ale nie WMS ani własne funkcje budowania adresów kafelków. Renderowanie WMS nadal wymaga `OpenLayers` oraz `W.map.addLayer` (lub mapy zwracanej przez `W.map.getOLMap()`). SDK LayerSwitcher udostępnia płaską listę checkboxów, a nie obecny układ kategorii i suwaków. Zachowanie wyglądu wymaga więc prywatnego DOM menu Warstwy i `wz-checkbox`. Te zależności są odizolowane w adapterach `WmsAdapter` i `LayerMenuAdapter`. Obsługiwane są alternatywne kontenery menu i zdarzenia checkboxów; brak wymaganych API lub przekroczenie limitu oczekiwania na inicjalizację jest zgłaszane w konsoli jako `[Geoportal]`. Nie można zagwarantować zgodności ze wszystkimi przyszłymi zmianami WME.

The bundled SDK typings (`wme-sdk-typings.tgz`, `v2.374-5-g0024d1fa65`) describe XYZ tiles, but not WMS or custom tile URL callbacks. WMS rendering still needs `OpenLayers` and `W.map.addLayer` (or the map returned by `W.map.getOLMap()`). The SDK LayerSwitcher provides a flat checkbox list, not the existing categories and sliders. Preserving the appearance therefore still requires the private Layers-menu DOM and `wz-checkbox`. These dependencies are isolated in `WmsAdapter` and `LayerMenuAdapter`. Alternative menu containers and checkbox events are supported; missing required APIs and initialization timeouts are reported in the console with a `[Geoportal]` prefix. Compatibility with every future WME change cannot be guaranteed.

**Weryfikacja / Verification:** Punktem odniesienia są dołączone typy SDK. Nie potwierdzono numeru najnowszego wdrożenia produkcyjnego ani działania w zalogowanej sesji WME — serwery Waze są niedostępne w środowisku weryfikacji. / The bundled SDK typings are the compatibility baseline. The latest production build number and operation in a logged-in WME session have not been verified; Waze servers are inaccessible from the validation environment.

[Dokumentacja SDK / SDK documentation](https://www.waze.com/editor/sdk/)

### Kontrola po aktualizacji WME / Check after a WME update

1. Otwórz WME i sprawdź **Warstwy → -- Geoportal PL --**, również po zamknięciu i ponownym otwarciu karty Warstwy. / Open WME and check **Layers → -- Geoportal PL --**, including after closing and reopening the Layers card.
2. Włącz ortofoto i adresy; sprawdź wyrównanie po przesunięciu mapy oraz znikanie/powrót adresów poniżej/od zoomu 14. / Enable orthophoto and addresses; check alignment after panning and address visibility below/at zoom 14.
3. Sprawdź suwaki, checkboxy i zachowanie ustawień po przeładowaniu WME. / Check sliders, checkboxes and settings after reloading WME.
4. Jeśli panel się nie pojawia, sprawdź komunikaty `[Geoportal]` w konsoli przeglądarki. / If the panel does not appear, check the browser console for `[Geoportal]` messages.

## Changelog [1.5.4] - 2026-10-14
* **WME SDK**: Inicjalizacja, stan użytkownika i zdarzenia mapy przez SDK. / SDK-based startup, user state and map events.
* **Bez zmian wyglądu / Unchanged UI**: Dotychczasowe kontrolki pozostają w menu Warstwy; obsługa ponownego tworzenia karty i zdarzeń checkboxów. / Existing controls remain in the Layers menu; handle card recreation and checkbox events.
* **Odporność / Resilience**: Sprawdzanie wymaganych API, odizolowane adaptery WMS i menu oraz komunikaty o niezgodności. / Required-API checks, isolated WMS and menu adapters and compatibility diagnostics.
* **Zoom SDK**: Natychmiastowa aktualizacja widoczności i sprawdzanie bieżącego zoomu przy żądaniu kafelków, również przed zdarzeniem SDK; zachowana obsługa odpowiedzi asynchronicznych. / Immediate visibility updates and current-zoom checks on tile requests, including before SDK event delivery; promise-returning responses remain supported.

## Changelog [1.5.0] - 2026-04-03
*   **Wsparcie API Marzec 2026 / March 2026 API Support**: Kompatybilność z nowym systemem kart ("Draggable Cards").
*   **MutationObserver**: Zwiekszenie stabilnosci renderowania menu przez WME.
*   **Nowy interfejs UI / New UI layout**: Dodano suwaki przezroczystości pod nazwami warstw, dodano obsługę Dark Mode.
*   **Wydajność / Performance**: Dodano lazy loading (ładowanie tylko włączonych warstw) oraz filtrację poziomów przybliżenia (zoom).
*   **Pamięć ustawień / Settings Persistence**: Automatyczne zapisywanie włączonych warstw i przezroczystości.
