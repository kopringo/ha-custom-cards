# Moje karty Home Assistant

Projekt do tworzenia własnych kart Lovelace i instalowania ich z jednego
repozytorium GitHub przez HACS. Gotowy pakiet zawiera trzy karty:


| Karta              | Typ                            | Konfiguracja                                                                 |
| ------------------ | ------------------------------ | ---------------------------------------------------------------------------- |
| **Pusta karta**    | `custom:ha-starter-card`       | Wizualny formularz tytułu i wysokości. Pusta zawartość do rozbudowy.         |
| **Powiedz w domu** | `custom:powiedz-w-domu-card`   | Do trzech głośników, gotowe komunikaty i własna wiadomość.                   |
| **Pomieszczenie**  | `custom:ha-pomieszczenie-card` | Nazwa, termostat, termometr, odczyt gniazdka i do trzech świateł.            |


Jeden zasób `dist/ha-custom-cards.js` rejestruje wszystkie karty w menu **Dodaj kartę**.
Możesz dodawać wiele instancji każdej karty, z niezależną konfiguracją.
Kod to zwykły JavaScript. Narzędzia budowania i testy korzystają wyłącznie z Node.js;
nie trzeba instalować zależności npm, frameworków ani bibliotek z CDN.

## Pierwsze uruchomienie: GitHub → HACS → HA



### 1. Umieść projekt na GitHubie

Utwórz **publiczne** repozytorium, najlepiej o nazwie `ha-custom-cards`.
Wgraj **zawartość tego katalogu** do głównego katalogu repozytorium.
Na najwyższym poziomie muszą być `hacs.json`, `README.md`, `package.json`,
`dist/`, `src/` i `.github/`, a nie dodatkowy katalog otaczający cały projekt.

Ustaw krótki opis repozytorium oraz tematy, np. `home-assistant`, `hacs`, `lovelace`.
Repozytorium może mieć inną nazwę: `hacs.json` wskazuje konkretny plik pakietu.
Wtedy w ręcznych adresach `/hacsfiles/...` używaj rzeczywistej nazwy repozytorium.

Pakiet `dist/ha-custom-cards.js` jest już zbudowany i znajduje się w projekcie.
Do pierwszej instalacji nie potrzebujesz Node.js ani GitHub Release.
Zalecamy jednak utworzenie pierwszego wydania krokiem poniżej, aby potem
aktualizować karty numerowanymi wersjami.

### 2. Opublikuj pierwsze wydanie

W repozytorium wybierz **Actions → Opublikuj wersje → Run workflow**.
Wybierz domyślną gałąź i podaj `1.0.0` (bez `v`). Workflow:

1. Sprawdza numer wersji, buduje pakiet i uruchamia testy.
2. Zapisuje aktualny `package.json` i `dist/ha-custom-cards.js` do repozytorium.
3. Tworzy tag `v1.0.0` i GitHub Release z gotowym plikiem JS.

Wymagane są włączone GitHub Actions i uprawnienie workflow do zapisu zawartości.
Workflow deklaruje `contents: write`, ale polityka organizacji albo ochrona gałęzi
może blokować zapis. Jeśli masz chronioną gałąź, użyj [ręcznej publikacji](docs/development.md#ręczna-publikacja).
Workflow uruchomiony dla innej niż domyślna gałęzi zostanie pominięty.

### 3. Dodaj repozytorium do HACS

Zakładamy, że HACS jest już zainstalowany i skonfigurowany.

1. **HACS → menu ⋮ → Własne repozytoria / Custom repositories**.
2. Wklej adres swojego repozytorium GitHub.
3. Wybierz typ **Dashboard** i dodaj repozytorium.
4. Wyszukaj **Moje karty HA**, pobierz i odśwież przeglądarkę.
5. W dashboardzie: **Edytuj → Dodaj kartę**. Wyszukaj **Pusta karta**, **Powiedz w domu** lub **Pomieszczenie**.

Nie musisz zgłaszać repozytorium do głównego katalogu HACS.
HACS instaluje frontend, ale nie tworzy skryptów backendowych.

Jeżeli korzystałeś z poprzedniego samodzielnego `powiedz-w-domu-card.js`, usuń
jego stary wpis z zasobów dashboardu przed załadowaniem tego pakietu i odśwież stronę.
Ta sama nazwa elementu nie może zostać zarejestrowana dwukrotnie w jednej sesji.

### 4. Jednorazowo utwórz skrypt TTS

1. W HA: **Ustawienia → Automatyzacje i sceny → Skrypty → Nowy skrypt**.
2. Otwórz edytor YAML i wklej [examples/powiedz-w-domu-script.yaml](examples/powiedz-w-domu-script.yaml).
3. Podmień `tts.twoj_silnik` na własną encję TTS z polskim głosem.
4. Zapisz skrypt. Zalecany identyfikator: `script.powiedz_w_domu`.
5. W wizualnym edytorze karty wybierz ten skrypt i głośniki.

Skrypt przyjmuje `tekst` oraz `glosniki` — listę encji `media_player`. Jedno
wywołanie odtwarza wiadomość na wszystkich zaznaczonych głośnikach. Jeżeli
masz starszą wersję z polem `glosnik`, zastąp ją tym plikiem. Ta karta nie
używa helperów `input_text` ani `input_select`.
Nie wklejaj pliku jednego skryptu bezpośrednio na najwyższym poziomie `scripts.yaml`;
w tym pliku potrzebny jest klucz `powiedz_w_domu:` i wcięcie całej zawartości pod nim.

Głos/język TTS ustawiasz w integracji lub akcji TTS. Pole `language: pl-PL`
w karcie dotyczy wyłącznie rozpoznawania dyktowanej wypowiedzi.

## Co można zmieniać w edytorze karty

- Tytuł, skrypt i do trzech głośników wybieranych z list encji.
- Nazwę, ikonę i to, czy głośnik jest zaznaczony domyślnie.
- Widoczność przycisku dyktowania i język rozpoznawania.
- Do dziesięciu komunikatów. Każdy ma jedno pole tekstu.

Pusty slot głośnika albo komunikatu nie pojawia się na karcie. Na karcie można
zaznaczyć kilka głośników naraz. Gotowy komunikat odtwarza się od razu.
**Własny komunikat** pokazuje pole tekstu i dyktowanie; odtwarza je przycisk **Odtwórz**.

## Karta pomieszczenia

W edytorze karty ustawiasz:

- nazwę pomieszczenia,
- pierwsze światło (`light` albo `switch`) — obok nazwy; zapalenie daje żółtą poświatę na karcie,
- termostat (`climate`) — aktualna temperatura, zadana i −/+; pomarańczowa ikona gdy grzeje,
- temperatura termostatu (`sensor`) — opcjonalny pomiar z urządzenia zamiast `current_temperature`,
- termometr w pokoju (`sensor` temperatury),
- gniazdko (`switch`) i opcjonalnie czujnik mocy — tylko odczyt, bez wyłączania.

Przykład: [examples/pomieszczenie-card.yaml](examples/pomieszczenie-card.yaml).

## Dodaj własną kartę

Zainstaluj Node.js 22 lub nowszy. W katalogu projektu uruchom:

```bash
npm run new:card -- pogoda-dom "Pogoda w domu"
```

Powstanie `src/cards/pogoda-dom/card.js` z nową nazwą elementu
`ha-pogoda-dom-card`, edytorem i wpisem w menu kart. Generator od razu buduje pakiet.
Edytuj zawartość `_render()` w nowym pliku. Ustawienia formularza zmieniaj
w `getConfigForm()`, a wartości początkowe w `getStubConfig()`.

```bash
npm run dev
```

Otwórz **[http://127.0.0.1:8124](http://127.0.0.1:8124)**. Podgląd używa przykładowych encji i symuluje
wywołania HA; nie steruje domem. Po zmianie źródeł odśwież stronę — pakiet zostanie
przebudowany. Ikony w podglądzie to uproszczone zastępniki; w HA używane są ikony MDI.

```bash
npm run build
npm test
```

Nowe katalogi w `src/cards/` są wykrywane automatycznie. Nie trzeba dopisywać
każdej nowej karty do pliku wejściowego. [Pełny przewodnik tworzenia kart](docs/development.md).

## Aktualizowanie kart

Po zmianach wypchnij źródła na GitHub, uruchom workflow **Opublikuj wersje**
z kolejnym numerem, np. `1.0.1`, a następnie pobierz aktualizację w HACS.
Odśwież przeglądarkę lub przeładuj frontend aplikacji Companion.
Wszystkie karty w pakiecie aktualizują się razem. Ich konfiguracja dashboardu
pozostaje w HA; zachowuj zgodność nazw pól przy zmianach kodu.

Zwykły workflow **Sprawdz projekt** buduje i testuje kod, lecz nie publikuje
wydania ani nie aktualizuje pliku `dist` w gałęzi. Przy edycji przez stronę GitHuba
uruchom później **Opublikuj wersje**. Przy pracy lokalnej możesz wcześniej
wykonać `npm run build` i commitować `dist` razem ze źródłami.

## Struktura projektu


| Ścieżka                              | Przeznaczenie                                                |
| ------------------------------------ | ------------------------------------------------------------ |
| `src/shared/kit.js`                  | Wspólna rejestracja kart i drobne narzędzia.                 |
| `src/cards/blank/card.js`            | Pusta karta i wzorzec dla generatora.                        |
| `src/cards/powiedz-w-domu/card.js`   | Karta komunikatów.                                           |
| `src/cards/powiedz-w-domu/editor.js` | Jej wizualny edytor.                                         |
| `src/cards/pomieszczenie/card.js`    | Karta pomieszczenia.                                         |
| `src/cards/pomieszczenie/editor.js`  | Jej wizualny edytor.                                         |
| `dist/ha-custom-cards.js`            | Gotowy plik pobierany przez HACS. Nie edytuj go ręcznie.     |
| `scripts/`                           | Budowanie, generator, serwer podglądu i wersjonowanie.       |
| `.github/workflows/`                 | Testy oraz publikacja wersji.                                |
| `examples/`                          | Przykładowe konfiguracje i skrypt HA.                        |
| `tests/`                             | Testy kontraktu HA, dyktowania, edytora i narzędzi projektu. |


