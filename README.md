# Warstwy geoportal.gov.pl dla WME (WME SDK)

Skrypt wyświetla warstwy z Geoportalu w edytorze Waze. Wyświetlane warstwy to: ortofotomapa ("podkład satelitarny"), numery domów i nazwy miejscowości. Wersja 1.5.6 (2026-10-15) korzysta z oficjalnego WME SDK (v2.374, tryb asynchroniczny) do inicjalizacji, odczytu stanu edytora i obsługi zdarzeń. Zachowuje dotychczasowy wygląd i położenie kontrolek w menu Warstwy.

Skrypt jest zbudowany na podstawie skryptu [geoportal.gov.pl layers for WME without translating PROXY](https://greasyfork.org/en/scripts/10611-geoportal-gov-pl-layers-for-wme-without-translating-proxy) autorstwa [Pawła Pyrczaka](https://greasyfork.org/en/users/9996-pawe%C5%82-pyrczak) oraz poprawek Stracha https://github.com/strah/WME-geoportal.pl oraz Kamila Maruda https://github.com/kmarud/WME-geoportal.pl

**Instalacja:** https://greasyfork.org/en/scripts/572377-geoportal-waze-integration-fork-by-snpl  

Pliki źródłowe są dostępne na [Githubie](https://github.com/sn-PL/WME-geoportal.pl), zapraszam do forkowania/aktualizacji.

## Jak używać

1. **Instalacja**: zainstaluj skrypt za pomocą menedżera skryptów (np. Tampermonkey).
2. **Uruchomienie**: otwórz Waze Map Editor.
3. **Warstwy**: w bocznym panelu "Warstwy" (pojawiającym się jako nowa karta) znajdziesz sekcję **"-- Geoportal PL --"**.
4. **Włączanie**: kliknij checkbox lub przesuń suwak przezroczystości w prawo. Zmiana suwaka automatycznie aktywuje warstwę.
5. **Przezroczystość**: suwak ustawiony na 0% automatycznie wyłącza warstwę.
6. **Kategorie**: warstwy są pogrupowane w zwijane kategorie (Ortofoto, Adresy, Podział Adm, BDOT).

## Zgodność z WME

Skrypt korzysta z oficjalnego WME SDK w trybie asynchronicznym (zalecanym od v2.371), czeka na gotowość edytora i sprawdza wymagane metody SDK. Nie używa prywatnych API `W.loginManager`, `W.map.getZoom`, `W.map.events` ani globalnego Lodash. Widoczność i kolejność warstw są odświeżane zarówno na zdarzeniach SDK, jak i na zdarzeniach samej mapy, więc zmiana lub brak zdarzenia SDK nie zatrzymuje skryptu. Zgodności ze wszystkimi przyszłymi zmianami WME nie można zagwarantować.

Do wyświetlania WMS potrzebne są nadal OpenLayers i `W.map.addLayer` (SDK obsługuje wyłącznie kafelki XYZ), a zachowanie obecnego układu kontrolek wymaga prywatnego DOM menu Warstwy i komponentu `wz-checkbox`; jeśli WME przestanie go udostępniać, po 30 sekundach pojawiają się zwykłe checkboxy o tym samym działaniu.

[Dokumentacja WME SDK](https://www.waze.com/editor/sdk/)

### Kontrola po aktualizacji WME

1. Otwórz WME i sprawdź **Warstwy → -- Geoportal PL --**, również po zamknięciu i ponownym otwarciu karty Warstwy.
2. Włącz ortofoto i adresy; sprawdź, że kafelki ortofoto pokrywają się z mapą po przesunięciu mapy i przy przybliżeniu powyżej 19 (kafelek poziomu 19 jest rozciągany), że nieudany kafelek zostawia dziurę, przez którą widać podkład WME — a nie pusty widok — oraz znikanie i powrót adresów poniżej i od zoomu 14.
3. Sprawdź suwaki, checkboxy i zachowanie ustawień po przeładowaniu WME.
4. Jeśli panel się nie pojawia, sprawdź komunikaty `[Geoportal]` w konsoli przeglądarki.

## Changelog [1.5.6] - 2026-10-15
* **Ortofoto standardowa jako kafelki WME z usługi kafelkowej Geoportalu**: warstwa nie pobiera już jednego obrazu na cały widok, tylko te same kafelki, z których zbudowana jest mapa edytora. Usługa kafelkowa (WMTS StandardResolution) ma siatkę Web Mercator EPSG:3857, 256 px, poziomy 0–19, o indeksach zwykłego z/x/y liczonego od północno-zachodniego narożnika świata, więc warstwa prosi o kafelek dokładnie dla tej komórki siatki, którą rysuje mapa (`TILEMATRIX=EPSG:3857:{z}&TILEROW={y}&TILECOL={x}`). Odrzucony kafelek to dziura w jednym miejscu: reszta widoku zostaje na ekranie, a przez dziurę widać standardowy podkład WME. Nie ma już obrazu całego widoku, który po odrzuceniu pustoszał.
* **Ortofoto high res na tej samej siatce, cięta po stronie klienta**: usługa HighResolution nie ma siatki 3857 (tylko EPSG:2180 i EPSG:4326 po 512 px), więc ta warstwa nadal korzysta z WMS, ale pobiera 256-px kafelki tej samej siatki co mapa (żądania `CRS=EPSG:4326` z BBOX-em pojedynczego kafelka, jak dotąd). Pojedyncze odrzucone żądanie to również dziura, a nie pusty widok.
* **Powyżej poziomu 19**: usługa kafelkowa kończy się na poziomie 19, więc powyżej niego warstwa nadal pyta o kafelek 19 i rozciąga go na ekranie — przybliżenia 20+ pokazują to, co ta usługa ma — zamiast prosić o nieistniejące kafelki i zostawiać puste miejsce.
* **Ponowienia i trzymanie obrazu bez zmian**: odrzucony kafelek wraca po 1 s i po 3 s (ze świeżym znacznikiem czasu w adresie), a warstwy, które nadal pobierają jeden obraz na widok (OSM, przejazdy kolejowe, drogi, kompozycje BDOT), trzymają na ekranie obraz, który już się wczytał — odrzucone odświeżenie nie zabiera im tego, co widać.
* **Bez zmian wyglądu**: te same warstwy, kategorie, checkboxy, suwaki i zapisane ustawienia; adres usługi zmienia się tylko dla ortofoto standardowej, która zamiast zapytania WMS o obraz widoku używa usługi kafelkowej tego samego serwisu.

## Changelog [1.5.5] - 2026-10-15
* **WME SDK v2.374**: SDK w zalecanym trybie asynchronicznym; wszystkie wywołania SDK obsługiwane przez `await`.
* **Odporność na aktualizacje WME**: gotowość edytora ze zdarzenia i ze stanu SDK, opcjonalne zdarzenia i dane użytkownika (bez nich wypada tylko warstwa OSM), wersje WME i SDK w konsoli, zapasowe checkboxy i izolacja błędów obsługi zdarzeń.
* **Wydajność**: koniec z odpytywaniem co 5 s — widoczność i kolejność warstw są odświeżane na zdarzeniach SDK oraz samej mapy, a samo przesuwanie mapy nie wykonuje żadnych wywołań SDK.
* **Zoom**: kafelki poniżej minimalnego przybliżenia są blokowane od razu, także przed zdarzeniem SDK.
* **Ortofoto w JPEG**: warstwy fotograficzne wysyłają żądania w formacie JPEG i bez parametru przezroczystości, dokładnie jak w wersjach 0.2.15 i w innych klientach tej usługi. Od 1.5.0 skrypt prosił o przezroczystość, czego OpenLayers nie mógł spełnić i po cichu podmieniał JPEG na PNG, przez co kafelki ortofoto były wielokrotnie cięższe.
* **Ortofoto: jedno żądanie na widok**: obie warstwy fotograficzne pobierają jeden obraz na cały widok mapy zamiast siatki kafli — usługa ortofotomapy standardowej odpowiada losowo pustą stroną (404), więc pojedyncze żądanie to o rząd wielkości mniej błędów w konsoli. Nieudany obraz jest ponawiany 3 razy: raz od razu, a gdy OpenLayers i tak uzna go za wczytany — dwa razy po 1 s i po 3 s, ze świeżym znacznikiem czasu w adresie, czyli już po serii odrzuceń. Odrzucone odświeżenie nie zabiera przy tym obrazu, który już jest na ekranie: OpenLayers wyrzuca poprzedni obraz, gdy tylko uzna nowy za wczytany (a odrzucenie też uznaje za wczytane), więc skrypt trzyma dostarczony widok do chwili, gdy naprawdę przyjdzie nowy, i puszcza go, gdy warstwa zostaje ukryta. Bez tego nieudany obraz zostawał na mapie jako wczytany i widok pustoszał aż do następnego większego przesunięcia lub zmiany przybliżenia; teraz obraz wraca sam, a kolejka ponowień otwiera się na nowo przy każdym przesunięciu mapy, każdej zmianie przybliżenia i po każdym wczytanym obrazie.
* **Kolejność warstw**: przywracanie z-index po dodaniu, usunięciu lub przestawieniu warstw mapy.
* **Komunikat pod warstwami**: po polsku (w 1.5.4 był po angielsku).
* **Bez zmian wyglądu**: te same warstwy, adresy usług WMS, kategorie, checkboxy, suwaki i zapisane ustawienia.

## Changelog [1.5.4] - 2026-10-14
* **WME SDK**: inicjalizacja, stan użytkownika i zdarzenia mapy przez SDK.
* **Bez zmian wyglądu**: dotychczasowe kontrolki pozostają w menu Warstwy; obsługa ponownego tworzenia karty i zdarzeń checkboxów.
* **Odporność**: sprawdzanie wymaganych API, odizolowane adaptery WMS i menu oraz komunikaty o niezgodności.
* **Zoom SDK**: natychmiastowa aktualizacja widoczności i sprawdzanie bieżącego zoomu przy żądaniu kafelków, również przed zdarzeniem SDK.

## Changelog [1.5.0] - 2026-04-03
*   **Wsparcie API Marzec 2026**: kompatybilność z nowym systemem kart ("Draggable Cards").
*   **MutationObserver**: zwiększenie stabilności renderowania menu przez WME.
*   **Nowy interfejs UI**: suwaki przezroczystości pod nazwami warstw, obsługa Dark Mode.
*   **Wydajność**: lazy loading (ładowanie tylko włączonych warstw) oraz filtracja poziomów przybliżenia.
*   **Pamięć ustawień**: automatyczne zapisywanie włączonych warstw i przezroczystości.
