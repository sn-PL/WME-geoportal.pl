# Warstwy geoportal.gov.pl dla WME (WME SDK)

Skrypt wyświetla warstwy z Geoportalu w edytorze Waze: ortofotomapę („podkład satelitarny”), adresy i nazwy miejscowości, granice, drogi, przejazdy kolejowe, obiekty topograficzne oraz warstwy BDOT10k. Wersja 1.6.0 (2026-10-15) korzysta z oficjalnego WME SDK (v2.374, tryb asynchroniczny). Wygląd i położenie kontrolek w menu Warstwy bez zmian.

Na podstawie skryptu [geoportal.gov.pl layers for WME without translating PROXY](https://greasyfork.org/en/scripts/10611-geoportal-gov-pl-layers-for-wme-without-translating-proxy) autorstwa [Pawła Pyrczaka](https://greasyfork.org/en/users/9996-pawe%C5%82-pyrczak) oraz poprawek Stracha https://github.com/strah/WME-geoportal.pl i Kamila Maruda https://github.com/kmarud/WME-geoportal.pl

**Instalacja:** https://greasyfork.org/en/scripts/572377-geoportal-waze-integration-fork-by-snpl

## Jak używać

1. Zainstaluj skrypt w menedżerze skryptów (np. Tampermonkey) i otwórz Waze Map Editor.
2. W panelu „Warstwy”, w karcie **-- Geoportal PL --**, włącz wybrane warstwy checkboxem. Suwak ustawia przezroczystość (0% wyłącza warstwę), a ustawienia zapisują się same.
3. Warstwy są pogrupowane w zwijane kategorie.

## Uwagi

* Warstwy BDOT10k, obiekty topograficzne i przejazdy kolejowe są rysowane w układzie 1992 (PUWG 1992) i mają dane tylko tam, gdzie publikuje je kompozycja BDOT10k, powiat (obiekty topograficzne) albo operator linii kolejowej.
* Skrypt opiera się na WME SDK oraz na OpenLayers i prywatnym DOM menu Warstwy; przyszłe zmiany WME mogą wymagać aktualizacji (komunikaty `[Geoportal]` w konsoli przeglądarki).
* Warstwy złożone z kresek i punktów rysują białe litery i linie z twardą krawędzią i cienką czarną obwódką (litery dwa razy większe, bo o taki obraz skrypt prosi usługę; obrazki tych warstw obejmują 4× większy obszar mapy niż kafelki, żeby usługa rysowała mniej kopii tych samych podpisów). Warstwy graniczne (Miasta, gminy, powiaty, województwa, granica państwa) mają własny filtr: ich blade nazwy są rozpoznawane po jasności i rysowane jako czysty biały atrament z jednopikselową czarną obwódką (to samo wygładzenie i ta sama krawędź co gdzie indziej), a wszystkie inne piksele rysunku — kolorowe obszary i linie granic — przechodzą bez zmian, bo tych obszarów nie można zamalować na biało. Warstwy, których kolorem jest sama mapa (drogi, BDOT), są tylko rozjaśniane. Opcje są nadal wyłącznie checkboxami (bez suwaków).
* Testy skryptu (jsdom + prawdziwy OpenLayers 2.13.1 + atrapa WME SDK) są w katalogu `test/` — `cd test && npm install && npm test`.

## Changelog [1.6.0] - 2026-10-20

* **Czytelne nazwy w grupie „Podział Administracyjny”**: litery warstw Miasta, gminy, powiaty, województwa i granica państwa to blade, szerokie podpisy na równie jasnej płytce samej usługi (pomiar: 230, 217, 231 na płytce 250, 248, 251) — na domyślnym satelitarnym podkładzie WME ginęły w całości. Teraz osobny filtr rozpoznaje dokładnie te piksele po ich jasności (prawie szare i jasne) i rysuje je od nowa jako czysty biały atrament z jednopikselową czarną obwódką, z tym samym wygładzeniem konturu co wszystkie inne podpisane warstwy. Kolorowe, półprzezroczyste obszary i linie granic przechodzą przez filtr bez zmian — nic z nich nie jest wybielane ani progowane.

## Changelog [1.6.0] - 2026-10-15

* **BDOT i przejazdy w układzie 1992**: te usługi rysują dane tylko w tym układzie — pytane w 4326 zwracały obrazek własnego błędu, który zakrywał mapę („szare pola”, „Invalid CRS given (EPSG:4326).”).
* **„Topografia / Inne” bez suwaków i czytelniejsze**: drogi, przejazdy i obiekty topograficzne mają sam checkbox, a cienkie ciemne linie i teksty dostają białą obwódkę i podbitą jasność, więc widać je na ciemnym podkładzie.
* **Suwaki BDOT usunięte**: każda warstwa BDOT jest tylko włączana checkboxem i rysuje się w pełnej nieprzezroczystości.
* **Błąd usługi to dziura, nie obrazek**: gdy usługa zwróci własny błąd, w tym miejscu nie pojawia się już szary obrazek z komunikatem („Invalid CRS given…”, „Error HRESULT E_FAIL…”), tylko pominięte miejsce, o które skrypt zapyta jeszcze raz.
* **OSM, ortofoto, przejazdy i obiekty topograficzne na kafelkach**: nieudany kafelek to jedna dziura, przez którą widać podkład WME, a nie pusta warstwa albo obraz błędu na cały widok.
* **Białe podpisy z cienką czarną obwódką**: warstwy złożone z kresek i punktów (numery działek, adresy, ulice, place, przejazdy, obiekty topograficzne) są rysowane od nowa — czysto białe litery i linie z jednopikselową czarną obwódką, a każda krawędź trafia dokładnie na siatkę pikseli. Nie ma szarej mgły ani białych otoczek, które zlewały się z literą. Czarna obwódka jest potrzebna: bez niej biały napis ginie na jasnym polu (łąka, beton).
* **Granice: ten sam kontur, ale bez przerabiania kolorów**: Miasta, gminy, powiaty, województwa i granica państwa rysują oprócz nazw także kolorowe, półprzezroczyste obszary — wybielenie całego rysunku zamalowałoby je białymi plamami, a próg krycia (jak w poprzedniej wersji) zlewał ich jasne, szerokie podpisy z własną jasną otoczką w jedną plamę. Dlatego te warstwy mają teraz dokładnie to, o co prosiłeś: nazwy pozostają takie, jakie rysuje usługa (są białe), a wokół całego rysunku — nazw, linii granic i obszarów — pojawia się jednopikselowa czarna obwódka. Nic nie jest rozjaśniane, wybielane ani progowane, więc kolorowe obszary i linie wyglądają jak w usłudze.
* **Większe litery bez rozmycia**: te warstwy proszą usługę o obraz w połowie pikseli tego, co zajmują na mapie. Usługa rysuje litery w stałej wielkości w pikselach obrazu, więc na mapie wychodzą dwa razy większe — a filtr wyostrza je z powrotem zamiast rozciągać rozmytą plamę. Wszystkie pozostałe warstwy proszą o dokładnie tyle pikseli, ile zajmują (podgląd do oceny: `test/tools/filter-preview.mjs`).
* **Kafelki wróciły**: działki, miejscowości, gminy, powiaty, województwa i granica państwa są znów kafelkami siatki mapy, tak jak ortofoto. Przesunięcie mapy w granicach marginesu nie wysyła ani jednego nowego żądania, a większe prosi tylko o pas, który odsłania — zamiast rysować od nowa cały widok przy każdym ruchu. Warstwy, które nie dają się narysować w całości na raz (przejazdy, BDOT), zostają jednobrazowe.
* **Gładkie litery**: litery rysuje usługa w rozmiarze obrazka, a obrazek jest rozciągany dwa razy na ekranie — każda krawędź piksela usługi staje się więc na ekranie schodkiem z dwóch pikseli i to było widać jako „postrzępione” litery. Teraz rysunek przed progiem przechodzi przez rozmycie 1,2 px, a sam próg jest krótkim zboczem (nachylenie 8), więc kontur litery jest gładki, a krawędź kreski delikatnie zmiękczona zamiast twardego schodka. Cienkie linie rysunku (granice działek) zostają — ich środek po rozmyciu nadal przekracza próg (sprawdzone w testach). Podgląd „poprzednio / teraz” na prawdziwych rysunkach usługi: `test/tools/filter-preview.mjs`.
* **Podpisy na większych obrazkach**: każdy obrazek usługa rysuje osobno, razem z podpisami — numer działki, który wypada na styku dwóch obrazków, jest rysowany w obu i stoi dwa razy obok siebie (to jest to „nachodzenie” numerów: dwa różne ułożenia tych samych cyfr, przesunięte o kilkadziesiąt pikseli, różniące się wielkością o kilka procent). Dlatego te warstwy są teraz cięte na duże komórki: **podział adm** i **Miasta** na 2048 × 2048 px (obrazek 1024 px), pozostałe na 1024 px (obrazek 512 px), a nie 256 px jak kafelki mapy. W oknie edytora (838 × 820 px) podział adm i Miasta to teraz **jeden obrazek** — usługa układa wszystkie numery i nazwy w jednym przebiegu i nie ma drugiego obrazka, w którym ten sam numer mógłby stanąć obok siebie. Zmierzone na zrzucie: z 16 numerów na ekranie 6 stało na szwie siatki 256 px, 3 na szwie 512 px, 2 na 1024 px i **1 na 2048 px** (a przy ułożeniu siatki, jakie wypada w oknie edytora, zero). Wielkość i wygląd liter się nie zmieniają.
* **Koniec podwójnych podpisów**: obraz należy do widoku, dla którego został narysowany. Gdy mapa prosi o inny obszar, poprzedni obraz jest zdejmowany od razu — wcześniej zostawał na mapie do czasu wczytania nowego, a jego napisy stały obok nowych, przesunięte o tyle, o ile przesunęła się mapa (to były „zdublowane” numery działek). Przy zmianie przybliżenia obraz nie jest przenoszony w ogóle. Warstwy bez suwaków pozostają bez suwaków.
* **Bez zmian**: pozostałe warstwy, kategorie, checkboxy, suwaki i zapisane ustawienia.
* **Ostrzeżenie**: usługi obiektów topograficznych i przejazdów mają dane tylko dla części kraju i tylko od pewnego przybliżenia.

## Changelog [1.5.8] - 2026-10-15

* **Ortofoto high res: powrót do kafelków 256 px** — 512 px było w praktyce wolniejsze.

## Changelog [1.5.6] - 2026-10-15

* **Ortofoto na kafelkach siatki mapy** — standardowa z usługi kafelkowej, high res cięta na kafelki po stronie przeglądarki; nieudany kafelek to dziura w widoku.

## Changelog [1.5.5] - 2026-10-15

* **WME SDK v2.374** w trybie asynchronicznym i odświeżanie widoczności na zdarzeniach (bez odpytywania).
* **Odrzucony obraz wraca** (ponowienia 1 s i 3 s), a warstwy jednobrazowe trzymają na ekranie obraz, który już się wczytał.
* **Ortofoto w JPEG** i jedno żądanie na widok zamiast siatki kafli.

## Changelog [1.5.4] - 2026-10-14

* **WME SDK**: inicjalizacja, stan użytkownika i zdarzenia mapy przez SDK; izolacja błędów i zapasowe checkboxy.

## Changelog [1.5.0] - 2026-04-03

*   **Nowy interfejs WME** („Draggable Cards”), suwaki przezroczystości, zapis ustawień, tryb ciemny.
*   **Wydajność**: ładowanie tylko włączonych warstw i filtrowanie poziomów przybliżenia.
