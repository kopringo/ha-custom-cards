# Tworzenie i publikowanie kart

## Założenia

Projekt ma jednoznaczny podział: źródła edytujesz w `src/`, a HA pobiera tylko
gotowy `dist/ha-custom-cards.js`. Plik zawiera wszystkie karty i edytory.
Nie ma zewnętrznych importów ani zależności od bibliotek hostowanych przez CDN.
Skrypt budowania scala pliki w jedną funkcję i sprawdza składnię JavaScript.
Nie jest transpilatorem ani pełnym bundlerem ESM: w plikach źródłowych nie używaj
`import`/`export`. Przy potrzebie npm/Lit możesz później zastąpić build esbuildem
lub Rollupem, zachowując nazwę pliku wynikowego dla HACS.

Wymagane narzędzia: Node.js >=22 oraz do publikowania lokalnego Git i opcjonalnie
GitHub CLI. Nie jest potrzebne `npm install`; projekt nie ma zależności npm.

## Nowa karta

```bash
npm run new:card -- temperatura "Temperatura w domu"
```

Generator tworzy nowy katalog i niezależny typ `custom:ha-temperatura-card`.
Nie nadpisuje istniejących katalogów. Nazwa może zawierać małe litery ASCII,
cyfry i myślniki. `blank`, `starter` i `powiedz-w-domu` są zarezerwowane.

Wygenerowana karta jest kopią `src/cards/blank/card.js`. Możesz zmienić ten wzorzec,
jeśli kolejne karty mają mieć inne ustawienia początkowe.

Najważniejsze miejsca w pliku:

| Miejsce | Co dopisać |
| --- | --- |
| `getStubConfig()` | Wartości początkowe dla nowej instancji. |
| `getConfigForm()` | Pola wizualnego formularza. |
| `setConfig()` | Walidację i normalizację danych konfiguracyjnych. |
| `set hass()` | Odbiór stanu HA; aktualizację zmieniających się elementów. |
| `_render()` | Własny interfejs. |
| `getCardSize()` / `getGridOptions()` | Rozmiar karty w układzie dashboardu. |
| `HaCardKit.register()` | Nazwę i opis widoczne w menu „Dodaj kartę”. |

Przykład odczytu stanu encji po otrzymaniu `hass`:

```javascript
const state = this._hass?.states?.[this._config.entity];
this._content.textContent = state?.state ?? "Encja niedostępna";
```

Przykład wywołania akcji po kliknięciu przez użytkownika:

```javascript
await this._hass.callService("light", "turn_on", {
  entity_id: this._config.entity,
});
```

Obsłuż błąd żądania i zablokuj podwójne wysłanie, tak jak w karcie „Powiedz w domu”.
Nie wywołuj akcji z `set hass()` ani podczas renderowania — te metody uruchamiają
się wielokrotnie i także w podglądach.

## Własny edytor

Do prostych ustawień wystarczy `getConfigForm()`. Przy bardziej rozbudowanych
formularzach dodaj w katalogu karty `editor.js`, zarejestruj jego element
i zwróć go z `static getConfigElement()`.

Edytor otrzymuje `setConfig(config)` i `hass`; po zmianie emituje:

```javascript
this.dispatchEvent(new CustomEvent("config-changed", {
  detail: { config: newConfig },
  bubbles: true,
  composed: true,
}));
```

Zachowuj obce pola konfiguracji, takie jak `visibility` i `grid_options`.
Echo konfiguracji z HA nie powinno przebudowywać aktywnego pola i zabierać mu fokusu.
Zobacz kompletny przykład w `src/cards/powiedz-w-domu/editor.js`.

## Podgląd i testy

```bash
npm run dev
```

Podgląd działa pod `http://127.0.0.1:8124`. Serwer nasłuchuje tylko lokalnie.
Odświeżenie strony pobiera świeżo zbudowany pakiet. Nowe karty pojawiają się
w selektorze. Demo obsługuje proste formularze `getConfigForm()` z polami tekstowymi
i liczbowymi oraz pełne edytory kart „Powiedz w domu” i „Pomieszczenie”. Po rozbudowaniu schematu
o inne selektory testuj je w HA lub rozszerz demo.

Demo symuluje głośniki i skrypt. Kliknięcie komunikatu albo „Odtwórz” pokazuje argumenty wywołania.
Opcje „Salon niedostępny” i „Symuluj błąd skryptu” ułatwiają testowanie błędów.
Nie jest to pełny frontend HA. Dyktowanie używa rzeczywistej funkcji przeglądarki
po kliknięciu przycisku i przyznaniu uprawnień.

```bash
npm run build
npm test
npm run check
```

`check` sprawdza również, czy wersjonowany pakiet `dist` odpowiada źródłom.
Testy są samowystarczalne; nie potrzebują połączenia z HA ani mikrofonu.
Sprawdzają m.in. argumenty skryptu, blokadę duplikatów, błędy, zachowanie szkicu,
cykl STT, edycję konfiguracji, generowanie nowej karty i poprawność paczki HACS.

## Publikowanie z interfejsu GitHub

1. Zapisz zmiany w `src/` na domyślnej gałęzi.
2. Otwórz **Actions → Opublikuj wersje → Run workflow**.
3. Podaj nowy numer, np. `1.0.1`. Nie zmieniaj ręcznie `package.json` — workflow
   zrobi to za Ciebie, zbuduje plik, uruchomi testy i doda Release.
4. Poczekaj na zielony wynik workflow, następnie sprawdź aktualizacje w HACS.

Sam tag bez GitHub Release nie jest pełnym wydaniem dla tego procesu.
Jeżeli publikacja zatrzyma się już po wysłaniu tagu, sprawdź kartę Releases.
Jeśli tag istnieje, ale nie ma wydania, utwórz wydanie z tego istniejącego tagu
i dołącz **plik z `dist` dokładnie z tego tagu**. Nie zastępuj go plikiem z nowszej gałęzi.
Alternatywnie opublikuj nową wersję. Nie używaj force-push do poprawiania wydań.

## Ręczna publikacja

Przy chronionej gałęzi przygotuj zmianę wersji lokalnie, przeprowadź wymagany PR,
a po scaleniu utwórz tag na zatwierdzonym commicie:

```bash
node scripts/set-version.mjs 1.0.1
npm run build
npm test
git add package.json src dist
git commit -m "Release v1.0.1"
```

Po wypchnięciu/scaleniu tych zmian i przejściu na właściwy commit:

```bash
git tag v1.0.1
git push origin v1.0.1
gh release create v1.0.1 dist/ha-custom-cards.js --verify-tag --title v1.0.1 --generate-notes
```

Możesz również utworzyć Release przez stronę GitHub i dołączyć plik JS ręcznie.
Zachowaj nazwę `ha-custom-cards.js` — wskazuje ją `hacs.json`.

## Instalacja ręczna

Skopiuj `dist/ha-custom-cards.js` do `www` w katalogu konfiguracji HA.
Dodaj zasób Moduł JavaScript z URL `/local/ha-custom-cards.js?v=1.0.0`.
Jeżeli dopiero tworzysz katalog `www`, zrestartuj HA. Odśwież przeglądarkę.
Przy aktualizacji zmień numer w URL zasobu, aby pobrać nowy plik.

Dla instalacji przez HACS i zasobów zarządzanych w YAML scal ten fragment
z istniejącą sekcją `lovelace` w `configuration.yaml`:

```yaml
lovelace:
  resource_mode: yaml
  resources:
    - url: /hacsfiles/ha-custom-cards/ha-custom-cards.js
      type: module
```

Adres zakłada nazwę repozytorium `ha-custom-cards`. Zaktualizuj go przy innej nazwie.
Nie rejestruj równocześnie tego samego pakietu z `/local/` i `/hacsfiles/`.

## Utrzymanie kodu

- Własne style umieszczaj w shadow DOM i korzystaj ze zmiennych motywu HA.
- Wartości użytkownika przypisuj przez `textContent`, `value` i `setAttribute`;
  nie doklejaj ich do HTML.
- Nie przebudowuj textarea ani formularza przy każdym `hass` update.
- W `disconnectedCallback()` usuń subskrypcje i przerwij mikrofon/timery.
- Testy logiki nie zastępują testu w prawdziwym HA i na telefonie.
- Kod JS jest publicznym zasobem. Nie umieszczaj w repozytorium tokenów HA ani haseł.
- Zmiany typu elementu `custom:...` są zmianami niezgodnymi wstecz. Zachowuj nazwy
  przy aktualizacjach, aby istniejące dashboardy działały dalej.
