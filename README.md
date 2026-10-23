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
* Podział Administracyjny (numery działek, Miasta, gminy, powiaty, województwa, granica państwa) rysuje **lite białe litery z jednopikselową czarną obwódką**, dwa razy większe, bo o taki obraz skrypt prosi usługę (obrazki tych warstw obejmują 4× większy obszar mapy niż kafelki, żeby usługa rysowała mniej kopii tych samych podpisów). Atramentem jest **cały kształt, jaki narysowała usługa** — nie sam jego ciemny kontur, bo wtedy litery wychodziły puste i szare — a biała tabliczka pod numerem i półprzezroczyste kolorowe obszary warstw granic zostają takie, jak je narysowano.
* Testy skryptu (jsdom + prawdziwy OpenLayers 2.13.1 + atrapa WME SDK) są w katalogu `test/` — `cd test && npm install && npm test`.

## Changelog [1.6.0] - 2026-10-15

* **BDOT i przejazdy w układzie 1992**: te usługi rysują dane tylko w tym układzie — pytane w 4326 zwracały obrazek własnego błędu, który zakrywał mapę („szare pola”, „Invalid CRS given (EPSG:4326).”).
* **„Topografia / Inne” bez suwaków i czytelniejsze**: drogi, przejazdy i obiekty topograficzne mają sam checkbox, a cienkie ciemne linie i teksty dostają białą obwódkę i podbitą jasność, więc widać je na ciemnym podkładzie.
* **Suwaki BDOT usunięte**: każda warstwa BDOT jest tylko włączana checkboxem i rysuje się w pełnej nieprzezroczystości.
* **Błąd usługi to dziura, nie obrazek**: gdy usługa zwróci własny błąd, w tym miejscu nie pojawia się już szary obrazek z komunikatem („Invalid CRS given…”, „Error HRESULT E_FAIL…”), tylko pominięte miejsce, o które skrypt zapyta jeszcze raz.
* **OSM, ortofoto, przejazdy i obiekty topograficzne na kafelkach**: nieudany kafelek to jedna dziura, przez którą widać podkład WME, a nie pusta warstwa albo obraz błędu na cały widok.
* **Cały „Podział Administracyjny” czytelny**: numery działek i nazwy granic (Miasta, gminy, powiaty, województwa, granica PL) proszą usługę o obraz w **jednej trzeciej** pikseli tego, co zajmują na mapie, więc usługa rysuje litery trzy razy większe. **Numery działek to osobna warstwa**: linie działek są bowiem grubości jednego piksela i muszą być rysowane w rozmiarze mapy — pomniejszone trzy razy zamieniają się w kreskę grubości jednej trzeciej piksela i wychodzą **przerywane**. Dlatego linie idą osobnym obrazem 1:1, a ich niebieski jest zamieniany na **czystą biel**; numery idą drugim obrazem, trzy razy większym. **Numery**: cyfra to biały kształt z własnym ciemnym konturem od usługi — ten kontur jest **kształtem cyfry i odstępem od sąsiedniej**, więc nic go nie zamalowuje. Biel w środku jest zalewana na czysto, całość dostaje trochę kontrastu, a czarna obwódka jest odrysowana **na zewnątrz** i położona pod spodem. **Nazwy granic**: litera usługi to kreska grubości jednego piksela — biała litera z ciemną obwódką, jakiej biała litera potrzebuje, wychodzi czarno-biała po połowie i czyta się jak pusty szkielet. Dlatego utwardzamy własny rysunek usługi: jej miękkie **białe halo** staje się czystą bielą, a miękkie litery czystą czernią. Linie granic, kolorowe i półprzezroczyste obszary oraz tabliczki zostają dokładnie takie, jakie narysowała usługa. Podgląd na prawdziwych obrazkach usługi: `test/tools/filter-preview.mjs`.
* **Pozostałe rysunki bez przerabiania**: adresy, ulice, place, przejazdy kolejowe i obiekty topograficzne są pokazywane dokładnie tak, jak rysuje je usługa (bez filtra, bez powiększania, w komórkach 256 px siatki edytora) — ulica jest w tym rysunku szeroką, półprzezroczystą powierzchnią, więc każda zmiana kolorów zamieniała ją w białą wstęgę, a numer domu w białą plamę.
* **Kafelki wróciły**: działki, miejscowości, gminy, powiaty, województwa i granica państwa są znów kafelkami siatki mapy, tak jak ortofoto. Przesunięcie mapy w granicach marginesu nie wysyła ani jednego nowego żądania, a większe prosi tylko o pas, który odsłania — zamiast rysować od nowa cały widok przy każdym ruchu. Warstwy, które nie dają się narysować w całości na raz (przejazdy, BDOT), zostają jednobrazowe.
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
