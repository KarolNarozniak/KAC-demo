from __future__ import annotations

import csv
import re
from collections import Counter, defaultdict
from pathlib import Path

from docx import Document
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_COLOR_INDEX
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from reportlab.lib import colors
from reportlab.lib.pagesizes import A3, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
CSV_PATH = REPO / 'Jira 2026-10-11T16_53_41+0200.csv'
SNAPSHOT = '11.10.2026 16:53 (UTC+02:00)'
DOC_DATE = '21.10.2026'
PROJECT = "KAC — Kernel 'Aura Kalendar'"
PROJECT_KEY = 'S23KC2S1P2'
TEAM = 'WCY23KC2S1'
TEAM_MEMBERS = [
    ('Karol Narozniak', 'Właściciel'),
    ('Michał Kozłowski', 'Współwłaściciel'),
    ('Jan Lizińczyk', 'Współwłaściciel'),
    ('Zuzanna Maksymów', 'Współwłaściciel'),
    ('Krzysztof Olszewski', 'Współwłaściciel'),
    ('Hubert Pogonowski', 'Współwłaściciel'),
    ('Klaudia Porzuczek', 'Współwłaściciel'),
]
NAVY = '1F4E78'
PALE_BLUE = 'D9EAF7'
LIGHT = 'F4F7FA'
EPIC_COLORS = {1: 'D9EAF7', 2: 'FCE4D6', 3: 'E4DFEC', 4: 'E2F0D9', 5: 'DDEBF7', 6: 'FFF2CC'}

EPIC_SCOPE = {
    1: ('Zarządzanie planem zajęć i wydarzeń', 'Kalendarz tygodniowy, wydarzenia, kategorie, obowiązkowość, powtarzanie i kolizje.'),
    2: ('Importowanie planu zajęć i grafiku pracy', 'Import ICS/CSV/PDF/zdjęcia, podgląd, poprawianie rozpoznania i deduplikacja.'),
    3: ('Określanie dostępności i celów pracy', 'Dostępność, cele godzin, stawka, odpoczynek, dni niedostępne i dojazd.'),
    4: ('Układanie grafiku pracy wokół zajęć', 'Generowanie propozycji, wykonalność celu, ręczne korekty i decyzja użytkownika.'),
    5: ('Synchronizowanie planu z Google Calendar', 'Wybór kalendarza, import, publikowanie, aktualizowanie i usuwanie zmian.'),
    6: ('Otrzymywanie powiadomień o planie', 'Przypomnienia, cisza nocna, konflikty, przekroczenie limitu i wykonalność celu.'),
}
EPIC_TO_WBS = {1: 'C1', 2: 'C2', 3: 'C3', 4: 'C4', 5: 'C5', 6: 'C6'}


def clean_jira_markup(value: str) -> str:
    value = (value or '').replace('\r', '\n').replace('\xa0', ' ')
    value = re.sub(r'\{\*\}', '', value)
    value = re.sub(r'\{\{([^{}]+)\}\}', r'\1', value)
    value = value.replace('*', '').replace('#', '')
    value = re.sub(r'\s+', ' ', value)
    return value.strip(' \t\n,;')


def extract_user_story(description: str, fallback: str):
    source = (description or '').replace('\r', '\n').replace('\xa0', ' ')
    marker = re.compile(
        r'(?:\*Jako\*|\{\*\}Jako\{\*\})\s*(.*?)\s*'
        r'(?:\*chcę\*|\{\*\}chcę\{\*\})\s*(.*?)\s*'
        r'(?:\*aby\*|\{\*\}aby\{\*\})\s*(.*?)(?=\n\s*\n|\n\s*W makiecie|\n\s*\*?1\.\s*Scenariusz|\Z)',
        re.IGNORECASE | re.DOTALL,
    )
    fallback_pattern = re.compile(
        r'\bJako\b\s+(.*?)\s+\bchcę\b\s+(.*?)\s+\baby\b\s+(.*?)(?=\n\s*\n|\n\s*W makiecie|\n\s*\*?1\.\s*Scenariusz|\Z)',
        re.IGNORECASE | re.DOTALL,
    )
    match = marker.search(source) or fallback_pattern.search(clean_jira_markup(source))
    if not match:
        return 'student', clean_jira_markup(fallback), '', False
    actor, want, benefit = (clean_jira_markup(group) for group in match.groups())
    return actor, want, benefit, True


def load_jira():
    with CSV_PATH.open('r', encoding='utf-8-sig', newline='') as stream:
        rows = list(csv.DictReader(stream))
    epics = {r.get('Klucz zgłoszenia', ''): (r.get('Podsumowanie', '') or '').strip()
             for r in rows if r.get('Typ zgłoszenia') == 'Epika'}
    stories = []
    for row in rows:
        if row.get('Typ zgłoszenia') != 'Historyjka':
            continue
        parent = row.get('Pole własne (Łącze epiki)', '') or ''
        number = int(parent.rsplit('-', 1)[-1]) if parent else 0
        summary = (row.get('Podsumowanie', '') or '').strip()
        actor, want, benefit, parsed = extract_user_story(row.get('Opis', ''), summary)
        stories.append({
            'key': row.get('Klucz zgłoszenia', ''),
            'type': row.get('Typ zgłoszenia', ''),
            'status': (row.get('Status', '') or '').strip(),
            'priority': (row.get('Priorytet', '') or '').strip(),
            'summary': summary,
            'description': row.get('Opis', '') or '',
            'epic_number': number,
            'epic_key': parent,
            'epic_name': epics.get(parent, 'Brak epiki'),
            'actor': actor,
            'want': want,
            'benefit': benefit,
            'parsed': parsed,
        })
    stories.sort(key=lambda x: (x['epic_number'], int(x['key'].rsplit('-', 1)[-1])))
    return rows, stories, epics


def set_cell_shading(cell, color):
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = tc_pr.find(qn('w:shd'))
    if shd is None:
        shd = OxmlElement('w:shd')
        tc_pr.append(shd)
    shd.set(qn('w:fill'), color)


def mark_repeat_header(row):
    props = row._tr.get_or_add_trPr()
    tag = OxmlElement('w:tblHeader')
    tag.set(qn('w:val'), 'true')
    props.append(tag)


def add_page_number(paragraph):
    paragraph.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    paragraph.add_run('Strona ')
    field = OxmlElement('w:fldSimple')
    field.set(qn('w:instr'), 'PAGE')
    paragraph._p.append(field)


def base_doc(title, doc_id, subtitle):
    doc = Document()
    section = doc.sections[0]
    section.top_margin, section.bottom_margin = Cm(1.8), Cm(1.7)
    section.left_margin, section.right_margin = Cm(2.0), Cm(2.0)
    normal = doc.styles['Normal']
    normal.font.name = 'Arial'
    normal.font.size = Pt(9.5)
    normal.font.color.rgb = RGBColor(38, 48, 60)
    normal.paragraph_format.space_after = Pt(5)
    normal.paragraph_format.line_spacing = 1.06
    for name, size in [('Title', 24), ('Heading 1', 15), ('Heading 2', 11.5), ('Heading 3', 10)]:
        style = doc.styles[name]
        style.font.name = 'Arial'
        style.font.size = Pt(size)
        style.font.bold = True
        style.font.color.rgb = RGBColor(31, 78, 121)
    header = section.header.paragraphs[0]
    header.text = f'KAC  |  FAZA DEFINICJI  |  {doc_id}'
    header.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    header.style = doc.styles['Caption']
    footer = section.footer.paragraphs[0]
    footer.add_run(f'{doc_id} · Wersja 1.0 · {DOC_DATE}                         ')
    add_page_number(footer)
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(20)
    r = p.add_run(title)
    r.bold, r.font.name, r.font.size = True, 'Arial', Pt(23)
    r.font.color.rgb = RGBColor(31, 78, 121)
    p = doc.add_paragraph(subtitle)
    p.paragraph_format.space_after = Pt(14)
    p.runs[0].font.size = Pt(11)
    p.runs[0].font.color.rgb = RGBColor(86, 98, 112)
    meta = doc.add_table(rows=0, cols=2)
    meta.style = 'Table Grid'
    for label, value in [
        ('Produkt', PROJECT), ('Klucz projektu', PROJECT_KEY), ('Zespół w eksporcie', TEAM),
        ('Źródło Jira', SNAPSHOT), ('Wersja / data', f'1.0 / {DOC_DATE}'),
        ('Zespół', f'{TEAM} — 7 osób; skład i role platformowe w README'), ('Status', 'Wersja robocza do przeglądu'),
    ]:
        cells = meta.add_row().cells
        cells[0].text, cells[1].text = label, value
        set_cell_shading(cells[0], 'D9EAF7')
    doc.add_paragraph()
    t = doc.add_table(rows=1, cols=4)
    t.style = 'Table Grid'
    for cell, value in zip(t.rows[0].cells, ['Data', 'Wersja', 'Zmiana', 'Autor']):
        cell.text = value
        set_cell_shading(cell, NAVY)
        for run in cell.paragraphs[0].runs:
            run.bold = True
            run.font.color.rgb = RGBColor(255, 255, 255)
    for cell, value in zip(t.add_row().cells, [DOC_DATE, '1.0', 'Pierwszy komplet artefaktów KAC na podstawie migawki Jira', 'Zespół projektu']):
        cell.text = value
    doc.add_page_break()
    return doc


def h(doc, title, level=1):
    doc.add_heading(title, level=level)


def p(doc, text, style=None):
    para = doc.add_paragraph(style=style)
    para.add_run(str(text))
    return para


def bullet(doc, text):
    p(doc, text, 'List Bullet')


def word_table(doc, headers, rows, font_size=8):
    t = doc.add_table(rows=1, cols=len(headers))
    t.style = 'Table Grid'
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    mark_repeat_header(t.rows[0])
    for cell, value in zip(t.rows[0].cells, headers):
        cell.text = str(value)
        set_cell_shading(cell, NAVY)
        for run in cell.paragraphs[0].runs:
            run.bold = True
            run.font.color.rgb = RGBColor(255, 255, 255)
            run.font.size = Pt(font_size)
    for i, values in enumerate(rows):
        cells = t.add_row().cells
        for cell, value in zip(cells, values):
            cell.text = str(value)
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
            if i % 2:
                set_cell_shading(cell, 'F4F7FA')
            for para in cell.paragraphs:
                for run in para.runs:
                    run.font.size = Pt(font_size)
    doc.add_paragraph()
    return t


def note(doc, title, body, fill='FFF2CC'):
    t = doc.add_table(rows=1, cols=1)
    t.style = 'Table Grid'
    set_cell_shading(t.cell(0, 0), fill)
    para = t.cell(0, 0).paragraphs[0]
    r = para.add_run(title + ': ')
    r.bold = True
    para.add_run(body)
    doc.add_paragraph()


def add_project_team(doc):
    h(doc, 'Zespół projektu (skład z listy dostępu)', 2)
    rows = [(name, access_role, 'Do przydzielenia przez Scrum Mastera') for name, access_role in TEAM_MEMBERS]
    word_table(doc, ['Imię i nazwisko', 'Rola widoczna na zrzucie', 'Rola projektowa / RUP'], rows, font_size=7.8)
    note(doc, 'Uwaga o rolach', '„Właściciel” i „Współwłaściciel” są rolami platformowymi widocznymi na zrzucie. Nie oznaczają Właściciela produktu, Scrum Mastera ani ról RUP. Nazwisko Scrum Mastera nie wynika ze zrzutu; trzeba je wskazać przed planowaniem odpowiedzialności i raportowaniem.')


def story_statistics(stories):
    status = Counter(s['status'] for s in stories)
    grouped = defaultdict(list)
    for story in stories:
        grouped[story['epic_number']].append(story)
    return status, grouped


def guess_action_group(story):
    return EPIC_SCOPE.get(story['epic_number'], ('Pozostałe', ''))[0]


def issue_id(story):
    return story['key'].rsplit('-', 1)[-1]


def build_problem_customer(rows, stories, epics):
    status, grouped = story_statistics(stories)
    doc = base_doc('Przedstawienie problemu — dokument Zamawiającego', 'KAC-A1', 'Cel biznesowy, użytkownicy i zakres oczekiwanych możliwości')
    h(doc, '1. Kontekst')
    p(doc, 'Projekt KAC — Kernel “Aura Kalendar” — odpowiada na potrzebę studentów, którzy łączą zajęcia akademickie, pracę zawodową i aktywności prywatne. Plan zajęć, zmiany w pracy i pozostałe wydarzenia pochodzą z różnych źródeł, dlatego student musi ręcznie zestawiać informacje, kontrolować kolizje i oceniać, ile czasu może przeznaczyć na pracę.')
    h(doc, '2. Problem do rozwiązania')
    for text in [
        'Brak jednego, aktualnego widoku tygodnia utrudnia rozpoznanie zajętych i wolnych przedziałów.',
        'Nakładające się wydarzenia lub zmiana planu mogą zostać przeoczone.',
        'Ręczne przepisywanie planu zajęć lub grafiku ze zdjęć i plików powoduje błędy i powielone wpisy.',
        'Student musi samodzielnie zestawiać obowiązkowe zajęcia, dostępność, czas dojazdu, odpoczynek i cel godzin pracy.',
        'Brak informacji o niewykonalnym celu może prowadzić do nierealnego grafiku.',
    ]:
        bullet(doc, text)
    h(doc, '3. Cel biznesowy')
    p(doc, 'Zapewnić studentowi wspólny kalendarz oraz narzędzia do importu, kontroli i planowania aktywności, tak aby mógł świadomie ułożyć grafik pracy wokół zajęć, sprawdzić konflikty i sam zdecydować, czy zaakceptować oraz opublikować proponowane zmiany.')
    h(doc, '4. Użytkownicy i interesariusze')
    word_table(doc, ['Rola', 'Potrzeba / odpowiedzialność'], [
        ('Student WAT / student pracujący', 'Podstawowy użytkownik kalendarza, importu, planera i powiadomień.'),
        ('Właściciel danych o zajęciach', 'Udostępnia właściwy plan lub plik źródłowy; zatwierdza rozpoznane dane akademickie.'),
        ('Źródło grafiku pracy', 'Dostarcza zmian roboczych w pliku/obrazie lub kalendarzu.'),
        ('Google Calendar', 'Zewnętrzne źródło kalendarza lub miejsce docelowe publikacji za zgodą studenta.'),
        ('Właściciel produktu / Scrum Master', 'Uzgadnia priorytety i odbiór; raport statusu do SharePoint przesyła wyłącznie Scrum Master.'),
    ])
    add_project_team(doc)
    h(doc, '5. Zakres funkcjonalny wynikający z Jira')
    epic_rows = []
    for n in range(1, 7):
        key = f'{PROJECT_KEY}-{n}'
        epic_rows.append((key, epics.get(key, ''), len(grouped[n]), EPIC_SCOPE[n][1]))
    word_table(doc, ['Epik', 'Nazwa epiku', 'Historie', 'Rezultat oczekiwany'], epic_rows, font_size=7.5)
    h(doc, '6. Kryteria powodzenia na poziomie produktu')
    for text in [
        'Student widzi wydarzenia tygodnia, kategorie, terminy obowiązkowe i ostrzeżenia o kolizjach.',
        'Importowane rekordy są widoczne do korekty i zatwierdzenia, a duplikaty są rozpoznawane.',
        'Propozycja grafiku uwzględnia dostępność i ograniczenia; niemożliwy cel jest jawnie komunikowany.',
        'Akceptacja jest osobną decyzją użytkownika, a anulowanie lub błąd publikacji nie zmienia grafiku.',
        'Powiadomienia i publikacja Google zachowują ustawienia użytkownika i czytelnie pokazują wynik.'
    ]:
        bullet(doc, text)
    h(doc, '7. Granica makiety i produktu docelowego')
    word_table(doc, ['Poziom', 'Założenie'], [
        ('Makieta demonstracyjna', 'Interakcje mogą być symulowane, a dane przechowywane w pamięci; interfejs jasno oznacza funkcje niepodłączone.'),
        ('Historie wymagające integracji', 'Jira zawiera wymagania JWT, API, SQL, Redis, Google OAuth/Calendar, OCR i synchronizacji. Nie należy deklarować ich jako działających bez implementacji, konfiguracji i testów.'),
        ('Logowanie / rejestracja', 'Dodane później do kierunku projektu; w migawce CSV nie ma dedykowanych historii rejestracji, resetu hasła ani profilu.'),
    ])
    h(doc, '8. Stan backlogu')
    p(doc, f'Źródłem jest CSV Jira z {SNAPSHOT}: {len(rows)} zgłoszeń (49 historyjek i 6 epików). W chwili eksportu: {status.get("W toku", 0)} historyjek w toku i {status.get("Do zrobienia", 0)} do zrobienia. Dla pełnej listy kluczy i przypisania do pakietów prac zob. arkusz „Rejestr Jira” w harmonogramie.')
    h(doc, '9. Kwestie do potwierdzenia')
    for text in [
        'Czy najbliższym celem jest wyłącznie makieta, czy wdrażamy już produkcyjne API i trwałą bazę?',
        'Jakie formaty i pliki testowe będą użyte do importu PDF/zdjęć oraz jak rozstrzygać błędne odczyty?',
        'Czy logowanie Google jest wymagane oddzielnie od zgody na Google Calendar?',
        'Które historie powtarzają/uzupełniają się i wymagają scalenia kryteriów akceptacji?',
        'Jakie są wymagane kanały i terminy powiadomień oraz warunki ich wysyłania?'
    ]:
        bullet(doc, text)
    return doc


def build_problem_contractor(rows, stories, epics):
    status, grouped = story_statistics(stories)
    doc = base_doc('Przedstawienie problemu — dokument Wykonawcy', 'KAC-A2', 'Analiza domeny, interesariuszy, epików i ryzyk backlogu')
    h(doc, '1. Cel i źródła')
    p(doc, f'Analiza Wykonawcy porządkuje backlog Jira {PROJECT_KEY} i opis produktu KAC. CSV zawiera {len(stories)} historii użytkownika i 6 epików; zachowano statusy i klucze z eksportu {SNAPSHOT}. Brief produktu z wcześniejszego polecenia służy jako kontekst. Przykładowe pliki MSIoPS i SWDsuw nie są źródłem wymagań KAC.')
    note(doc, 'Źródło prawdy', 'KAC jest projektem kalendarza czasu studenta. Żaden fragment ćwiczenia Soft-AS/SWS ani starego projektu SWDsuw nie jest włączany do zakresu KAC.')
    h(doc, '2. Użytkownicy, potrzeby i procesy')
    word_table(doc, ['Aktor / kontekst', 'Potrzeba', 'Proces / rezultat'], [
        ('Student', 'Widzieć zajęcia, pracę i sprawy prywatne razem.', 'Tygodniowy kalendarz z kategoriami i nawigacją.'),
        ('Student', 'Przenieść istniejący plan do KAC bez ręcznego wpisywania.', 'Import → podgląd → korekta → kontrola duplikatów → zapis.'),
        ('Student pracujący', 'Uzyskać wykonalny plan pracy.', 'Preferencje → obliczenie możliwości → propozycja → ręczna edycja → akceptacja.'),
        ('Student', 'Widzieć plan w Google Calendar i dostawać przypomnienia.', 'Autoryzacja → wybór kalendarza → podgląd/publikacja → synchronizacja lub alert.'),
    ])
    add_project_team(doc)
    h(doc, '3. Epiki i liczba powiązanych historii')
    epic_rows = []
    for n in range(1, 7):
        k = f'{PROJECT_KEY}-{n}'
        keys = ', '.join(s['key'] for s in grouped[n])
        epic_rows.append((k, epics.get(k, ''), len(grouped[n]), keys))
    word_table(doc, ['Klucz epiku', 'Nazwa', 'Liczba historii', 'Powiązane klucze'], epic_rows, font_size=7.2)
    h(doc, '4. Granica domeny i wymagane decyzje')
    for x in [
        'Model kalendarza musi rozróżniać wydarzenie jednorazowe, serię tygodniową, wydarzenie obowiązkowe, kategorię i zmianę pracy.',
        'Planer musi ujawniać konflikty, niewykonalny cel i brakujące godziny; nie może potajemnie zmieniać zaakceptowanych danych.',
        'Import wymaga śledzenia źródła, podglądu/korekty, reguły deduplikacji oraz zachowania przy pliku pustym, uszkodzonym lub częściowo rozpoznanym.',
        'Logowanie Google, import kalendarza i zapis do kalendarza to odrębne zgody. Zakres uprawnień tylko do odczytu różni się od uprawnień zapisu.',
        'Powiadomienia w godzinach ciszy oraz błędy/ponowienia wymagają czasu lokalnego i jawnych ustawień studenta.',
        'Wiek i strefa czasowa, rozstrzyganie zmiany czasu DST, początek tygodnia, limity zmian oraz reguła kolizji muszą mieć kryteria akceptacji.',
    ]:
        bullet(doc, x)
    h(doc, '5. Rozbieżności i duplikaty w backlogu')
    word_table(doc, ['Klucze', 'Obserwacja', 'Działanie Wykonawcy'], [
        ('-19 / -51', 'Powielanie zajęć w kolejnych tygodniach.', 'Uzgodnić, czy są dwie historie czy wspólna reguła cykliczności.'),
        ('-26 / -54', 'Obowiązkowe zajęcia i ich wyróżnianie.', 'Rozdzielić semantyczny status obowiązkowości od prezentacji wizualnej.'),
        ('-37 / -53', 'Wyświetlanie tygodnia i przegląd kolejnych tygodni.', 'Zdefiniować jeden zakres widoku i zachowanie na mobile.'),
        ('-43 / -55 / -42', 'Wykrywanie, ostrzeganie i szczegółowa informacja o konflikcie.', 'Powiązać detekcję, modal, ponowną walidację i zachowanie po anulowaniu.'),
        ('-12 / -27 / -41 / -23 / -30 / -47', 'Połączenie, import, wybór kalendarza, synchronizacja i publikacja.', 'Rozdzielić odczyt od zapisu i opisać zakres OAuth.'),
    ])
    h(doc, '6. Mock a produkcja')
    tech_rows = []
    for s in stories:
        desc = s['description'].lower()
        matches = []
        for token in ['jwt', 'sql', '/api/', 'redis', 'multipart/form-data', 'http']:
            if token in desc:
                matches.append(token)
        if matches:
            tech_rows.append((s['key'], s['summary'], ', '.join(sorted(set(matches)))))
    if tech_rows:
        word_table(doc, ['Klucz', 'Historia', 'Wzmianki implementacyjne w opisie'], tech_rows, font_size=7.5)
    p(doc, 'Wykryte nazwy techniczne są śladami w opisach Jira, a nie automatycznie zatwierdzonym wyborem architektury. Aktualna makieta działa bez trwałego backendu. Każda decyzja o SQL/API/Redis, uwierzytelnieniu lub synchronizacji wymaga architekta, zakresu bezpieczeństwa i kryteriów operacyjnych.')
    h(doc, '7. Ryzyka i otwarte decyzje')
    for x in [
        'OAuth i dostęp do danych Google: testowy/produkcyjny status aplikacji, weryfikacja zakresów i bezpieczne przechowywanie tokenów.',
        'Import OCR/PDF/zdjęcia: jakość rozpoznania, limity plików, prywatność i koszty usługi.',
        'Planowanie: jawne priorytety funkcji celu oraz postępowanie, gdy cel jest niewykonalny.',
        'Trwałość danych: backup, usuwanie danych, retencja i tożsamość właściciela kalendarza.',
        'Cisza nocna, przypomnienia i DST: strefa czasowa, zmiana czasu i powiadomienia przypadające na granicę zakresu.',
        'Dodatkowy zakres logowania/rejestracji i onboardingu nie ma odrębnych issue w eksportowanym backlogu — należy go dopisać przed produkcyjnym wdrożeniem.',
    ]:
        bullet(doc, x)
    return doc


def build_vision_kac(stories, epics):
    grouped = defaultdict(list)
    for story in stories:
        grouped[story['epic_number']].append(story)
    status = Counter(s['status'] for s in stories)
    doc = base_doc('Wizja projektu KAC', 'KAC-A3', "Wizja produktu Kernel 'Aura Kalendar' według backlogu Jira")
    h(doc, '1. Wstęp')
    h(doc, '1.1 Cel', 2)
    p(doc, 'Wizja określa, dla kogo powstaje KAC, jaki problem rozwiązuje i jakie możliwości mają znaleźć się w produkcie. Stanowi bazę do rozwoju scenariuszy, kryteriów akceptacji i iteracji RUP; nie jest potwierdzeniem, że historie ze statusem „Do zrobienia” zostały wdrożone.')
    h(doc, '1.2 Zakres', 2)
    p(doc, f'Źródłem zakresu funkcjonalnego jest 49 historyjek z eksportu {SNAPSHOT}, pogrupowanych w sześć epik. Dodatkowy onboarding konta zgłoszony po eksporcie jest opisany jako rozszerzenie i wymaga uzupełnienia Jira.')
    h(doc, '1.3 Definicje i akronimy', 2)
    word_table(doc, ['Termin', 'Znaczenie'], [
        ('KAC', "Kernel 'Aura Kalendar' — produkt dla studentów planujących naukę, pracę i życie prywatne."),
        ('WAT', 'Wojskowa Akademia Techniczna — kontekst grupy projektowej i głównej grupy docelowej.'),
        ('RUP', 'Iteracyjny proces: Incepcja, Doprecyzowanie, Budowa, Przekazanie.'),
        ('Epik', 'Obszar funkcjonalny agregujący powiązane historyjki Jira.'),
    ])
    h(doc, '2. Pozycjonowanie produktu')
    h(doc, '2.1 Problem i potrzeba', 2)
    p(doc, 'Studenci łączący naukę i pracę muszą koordynować informacje z planu zajęć, grafiku zmian i kalendarza prywatnego. KAC ma zapewnić wspólny widok tygodnia, wykrywać kolizje i pomóc zaplanować wykonalny grafik pracy z uwzględnieniem obowiązkowych zajęć i odpoczynku.')
    h(doc, '2.2 Deklaracja pozycjonowania produktu', 2)
    p(doc, "Dla studentów WAT i studentów pracujących, którzy potrzebują jednego wiarygodnego widoku tygodnia, KAC — Kernel 'Aura Kalendar' — jest kalendarzem i planerem, który łączy zajęcia, pracę i wydarzenia prywatne, pozwala sprawdzić konflikty oraz przygotować propozycję pracy do samodzielnej korekty i akceptacji. Import i synchronizacja są możliwe po świadomej zgodzie, a ich aktualne zachowanie w makiecie jest symulowane.")
    h(doc, '2.3 Cele biznesowe', 2)
    for item in [
        'Ułatwić przegląd całego tygodnia, w tym sobót i niedziel oraz wydarzeń cyklicznych.',
        'Ograniczyć ręczne przepisywanie planów przez import i kontrolę danych.',
        'Zmniejszyć ryzyko kolizji i pominięcia obowiązkowych zajęć.',
        'Pomagać dopasować liczbę godzin pracy do dostępności i ograniczeń studenta.',
        'Umożliwić studentowi świadomą akceptację lub odrzucenie proponowanego grafiku.',
        'Wspierać przypomnienia i opcjonalną wymianę wydarzeń z Google Calendar.',
    ]:
        bullet(doc, item)
    h(doc, '3. Interesariusze i użytkownicy')
    word_table(doc, ['Rola', 'Potrzeby / interes'], [
        ('Student WAT', 'Główny użytkownik: widok tygodnia, import planu, korekta danych i kontrola obowiązkowości.'),
        ('Student pracujący', 'Dostępność, cel/limit godzin, dojazdy, odpoczynek, propozycja i akceptacja grafiku.'),
        ('Właściciel planu zajęć', 'Dostarczenie prawidłowych danych akademickich i informacji o zajęciach obowiązkowych.'),
        ('Źródło zmian roboczych', 'Plik, obraz lub kalendarz zawierający grafik pracy studenta.'),
        ('Google Calendar', 'Zewnętrzny kalendarz do odczytu lub publikacji po udzieleniu odpowiedniego zakresu zgody.'),
        ('Właściciel produktu / Scrum Master', 'Właściciel priorytetów i akceptacji; wyłącznie Scrum Master przekazuje raport.'),
    ])
    add_project_team(doc)
    h(doc, '4. Główne możliwości produktu i śledzenie epik')
    epics_rows = []
    for number in range(1, 7):
        key = f'{PROJECT_KEY}-{number}'
        issue_keys = ', '.join(story['key'] for story in grouped[number])
        epics_rows.append((key, epics.get(key, ''), len(grouped[number]), issue_keys, EPIC_SCOPE[number][1]))
    word_table(doc, ['Epik', 'Nazwa Jira', 'Historie', 'Klucze', 'Wynik użytkownika'], epics_rows, font_size=7.0)
    h(doc, '5. Priorytetowy przepływ użytkownika')
    for title, text in [
        ('Kalendarz', 'Otwiera tydzień, przegląda dni, dodaje/edytuje wydarzenia, odróżnia kategorie i status obowiązkowości oraz otrzymuje ostrzeżenie o kolizji.'),
        ('Import', 'Wskazuje źródło, przegląda i poprawia rozpoznane rekordy, usuwa duplikaty i zatwierdza zapis.'),
        ('Plan pracy', 'Ustawia dostępność, cel i ograniczenia; otrzymuje propozycję, informację o brakujących godzinach i możliwość ręcznej korekty.'),
        ('Akceptacja i synchronizacja', 'Akceptuje propozycję, wybiera kalendarz, przegląda zmiany i dopiero potem publikuje; odłączenie lub błąd nie zmienia zaakceptowanego planu.'),
        ('Powiadomienia', 'Konfiguruje rodzaje przypomnień i godziny ciszy oraz widzi przyczynę blokowania alertu.'),
    ]:
        h(doc, title, 2)
        p(doc, text)
    h(doc, '6. Granice i modele realizacji')
    word_table(doc, ['Wariant', 'Zakres', 'Status / warunek'], [
        ('Demonstrator', 'Makieta interakcji, dane przykładowe i lokalne symulacje importu, Google, publikacji i przypomnień.', 'Aktualna wersja nie tworzy konta ani nie wykonuje prawdziwych wywołań Google.'),
        ('Docelowa integracja', 'Jira wskazuje JWT, API, SQL, Redis, OAuth Google, importy plików i synchronizację.', 'Wymaga decyzji architektury, uprawnień, retencji, weryfikacji Google i testów integracyjnych.'),
        ('Logowanie i onboarding', 'Rejestracja, logowanie Google, reset hasła, profil, import kalendarza i planu.', 'Zgłoszone po eksporcie Jira; należy dodać historyjki i kryteria akceptacji.'),
    ])
    h(doc, '7. Atrybuty jakościowe do zatwierdzenia')
    for item in [
        'Responsywność i dostępność interfejsu na telefonie oraz komputerze.',
        'Poprawność stref czasowych, zmian DST, granic tygodnia i kolizji w przedziałach [start, end).',
        'Poufność kalendarzy i tokenów Google oraz minimalny zakres uprawnień.',
        'Brak utraty danych przy anulowaniu, błędnym imporcie lub nieudanej publikacji.',
        'Akceptowalne czasy działania, wolumen plików, liczba studentów i dostępność nie są określone w eksporcie.',
    ]:
        bullet(doc, item)
    h(doc, '8. Ryzyka i decyzje')
    for item in [
        'Uzgodnić, czy zakres jest makietą demonstracyjną, czy systemem produkcyjnym z trwałym API i bazą.',
        'Rozdzielić rejestrację/logowanie Google od zgody na import/publikowanie Google Calendar.',
        'Uzgodnić reguły cykliczności przy edycji/usuwaniu pojedynczego wystąpienia i całej serii.',
        'Rozstrzygnąć potencjalne duplikaty historii i ujednolicić kryteria akceptacji.',
        'Zapisać nowe historie auth/onboarding oraz wymagania e-mail i sesji, jeśli mają być częścią wydania.',
    ]:
        bullet(doc, item)
    h(doc, '9. Macierz statusów')
    status = Counter(s['status'] for s in stories)
    p(doc, f'Na migawkę {SNAPSHOT}: {status.get("W toku", 0)} historyjek „W toku” i {status.get("Do zrobienia", 0)} „Do zrobienia”. Pełny rejestr 49 historii/6 epik wraz z powiązaniem z pakietem RUP zawiera skoroszyt 04_Wstepny_harmonogram_RUP_KAC.xlsx.')
    return doc
def build_linguistic_analysis(stories):
    doc = base_doc('Analiza lingwistyczna historyjek Jira KAC', 'KAC-A5', 'Stwierdzenia użytkownika, grupy czasownikowe/rzeczownikowe i wynik syntezy')
    note(doc, 'Materiał', 'Analizowane są 49 stwierdzeń „Jako–chcę–aby” z CSV Jira KAC. Nie analizujemy przykładowego tekstu Soft-AS ani poprzedniego projektu SWDsuw.')
    h(doc, '1. Legenda i metoda')
    word_table(doc, ['Kolor', 'Znaczenie'], [('Żółty', 'Grupy rzeczownikowe: aktorzy, obiekty i wartości domenowe.'), ('Zielony', 'Grupy czasownikowe: działania użytkownika lub systemu.')])
    p(doc, 'Opis Jira zawiera również scenariusze, warunki i wymagania implementacyjne. Kolorowanie poniżej obejmuje podstawowe zdanie użytkownika. Tabele oddzielają obserwowane grupy gramatyczne; nie są one automatycznym modelem klas.')
    h(doc, '2. Pokolorowane stwierdzenia historyjek')
    for s in stories:
        p0 = doc.add_paragraph()
        r = p0.add_run(f"{s['key']} — {s['summary']} [{s['status']}]")
        r.bold = True
        r.font.color.rgb = RGBColor(31, 78, 121)
        st = doc.add_paragraph()
        st.add_run('Jako ')
        actor_run = st.add_run(s['actor'] or 'student')
        actor_run.font.highlight_color = WD_COLOR_INDEX.YELLOW
        st.add_run(' chcę ')
        action_run = st.add_run(s['want'] or s['summary'])
        action_run.font.highlight_color = WD_COLOR_INDEX.BRIGHT_GREEN
        if s['benefit']:
            st.add_run(', aby ' + s['benefit'] + '.')
    h(doc, '3. Grupy czasownikowe')
    verb_rows = [(s['key'], s['actor'], s['want'], guess_action_group(s), s['benefit']) for s in stories]
    word_table(doc, ['Klucz Jira', 'Aktor', 'Grupa czasownikowa / działanie', 'Rodzina działania', 'Cel działania'], verb_rows, font_size=6.8)
    h(doc, '4. Grupy rzeczownikowe')
    lexicon = [
        ('student', r'\bstudent\w*', 'Aktor'), ('profil', r'\bprofil\w*', 'Dane użytkownika'),
        ('kalendarz', r'\bkalendar\w*', 'Zbiór wydarzeń / źródło'), ('wydarzenie', r'\bwydarzen\w*|\bwydarzeni\w*', 'Obiekt kalendarza'),
        ('plan zajęć', r'\bplan\w*\s+zaję\w*', 'Zbiór akademicki'), ('zajęcia', r'\bzaję\w*', 'Obowiązek akademicki'),
        ('kategoria', r'\bkategor\w*', 'Klasyfikacja'), ('kolor', r'\bkolor\w*', 'Atrybut prezentacyjny'),
        ('seria', r'\bseri\w*|\bpowtarz\w*', 'Reguła powtarzania'), ('termin', r'\btermin\w*|\bgodzin\w*', 'Atrybut czasowy'),
        ('kolizja', r'\bkoliz\w*|\bkonflikt\w*', 'Wynik analizy'), ('grafik', r'\bgrafik\w*', 'Plan pracy'),
        ('zmiana', r'\bzmian\w*', 'Blok pracy'), ('dostępność', r'\bdostępnoś\w*', 'Preferencja'),
        ('cel / limit', r'\bcel\w*|\blimit\w*|\bmaksymaln\w*', 'Ograniczenie planowania'),
        ('stawka', r'\bstawk\w*', 'Parametr obliczeń'), ('odpoczynek / dojazd', r'\bodpocz\w*|\bdojazd\w*|\bprzerw\w*', 'Bufor czasu'),
        ('import / plik', r'\bimport\w*|\bplik\w*|\bzdję\w*|\bpdf\b|\bics\b|\bcsv\b', 'Źródło / proces'),
        ('duplikat', r'\bduplikat\w*', 'Wynik walidacji'), ('akceptacja', r'\bakcept\w*|\bzatwierdz\w*', 'Decyzja'),
        ('Google Calendar', r'\bgoogle\s+calendar\b|\bgoogle\b', 'System zewnętrzny'),
        ('powiadomienie / cisza', r'\bpowiadom\w*|\bprzypomn\w*|\bciszy\b', 'Konfiguracja / zdarzenie'),
    ]
    found = defaultdict(lambda: {'forms': set(), 'keys': set(), 'classification': ''})
    for s in stories:
        text = ' '.join([s['summary'], s['actor'], s['want'], s['benefit']])
        for term, pattern, classification in lexicon:
            matches = {m.group(0) for m in re.finditer(pattern, text, re.IGNORECASE)}
            if matches:
                found[term]['forms'].update(matches)
                found[term]['keys'].add(s['key'])
                found[term]['classification'] = classification
    noun_rows = [(term, ', '.join(sorted(v['forms'])), v['classification'], ', '.join(sorted(v['keys']))) for term, v in sorted(found.items())]
    word_table(doc, ['Grupa rzeczownikowa', 'Formy w historiach', 'Klasyfikacja wstępna', 'Przykładowe klucze'], noun_rows, font_size=7)
    h(doc, '5. Kandydaci na obiekty projektowe — wynik analizy')
    p(doc, 'Kandydaci wynikają z powtarzających się grup i odpowiedzialności biznesowych, a nie z samego wystąpienia rzeczownika. To propozycja do walidacji przez zespół i użytkowników, nie zatwierdzony schemat bazy danych.')
    for name, meaning, refs in [
        ('Użytkownik / Student', 'Właściciel profilu, kalendarza, preferencji i decyzji o grafiku. Osobne konto wymaga nowych historyjek auth.', 'E1–E6; rozszerzenie auth poza CSV.'),
        ('Kalendarz', 'Zbiór wydarzeń przypisany do użytkownika i źródła.', 'E1, E2, E5.'),
        ('Wydarzenie', 'Wpis z tytułem, kategorią, przedziałem czasu i opcjonalnymi atrybutami obowiązkowości/powtarzania.', 'E1, E2, E5.'),
        ('Seria wydarzeń', 'Wzorzec kolejnych tygodniowych wystąpień.', 'E1.'),
        ('Plan zajęć', 'Wydarzenia akademickie importowane i weryfikowane przez studenta.', 'E2, E4.'),
        ('Preferencje planowania', 'Dostępność, limit, cel, stawka, przerwy, dojazd i dni blokowane.', 'E3, E4.'),
        ('Zmiana robocza', 'Blok pracy, który może być proponowany, edytowany, zaakceptowany i synchronizowany.', 'E4, E5, E6.'),
        ('Propozycja grafiku', 'Zbiór zmian wraz z informacją o osiągnięciu celu i statusem decyzji studenta.', 'E4.'),
        ('Import / podgląd importu', 'Proces oraz tymczasowy zbiór rozpoznanych rekordów przed zatwierdzeniem.', 'E2.'),
        ('Konflikt', 'Wyliczany wynik nakładania się przedziałów; nie musi być trwałą encją.', 'E1, E6.'),
        ('Ustawienia przypomnień', 'Preferencje i reguły, według których powiadomienie jest dozwolone.', 'E6.'),
    ]:
        q = doc.add_paragraph(style='List Bullet')
        r = q.add_run(name + ' — ')
        r.bold = True
        q.add_run(f'{meaning} Źródła: {refs}')
    h(doc, '6. Pojęcia, które nie są same w sobie obiektami biznesowymi')
    for x in [
        'Kolor, stawka, limit i obowiązkowość są wartościami/atrybutami; należy przypisać je odpowiedniemu pojęciu.',
        'Generowanie, import, synchronizacja i publikacja opisują procesy; ich trwałe rekordy wymagają uzasadnienia retry/audytem.',
        'API, JWT, SQL, Redis, OCR, ICS i OAuth są rozwiązaniami technicznymi, nie pojęciami słownika domenowego.',
        'Pełne opisy scenariuszy i warunków akceptacji pozostają w CSV Jira; tę analizę można odtworzyć po zmianie snapshotu.',
    ]:
        bullet(doc, x)
    return doc


def build_glossary():
    terms = [
        ('Student', 'Podstawowy użytkownik KAC, który planuje zajęcia, pracę i aktywności prywatne.'),
        ('Profil studenta', 'Zestaw danych potrzebnych do ustawienia kalendarza i preferencji.'),
        ('Kalendarz', 'Uporządkowany zbiór wydarzeń przypisany użytkownikowi lub źródłu.'),
        ('Tydzień planu', 'Zakres kalendarza od poniedziałku do niedzieli.'),
        ('Wydarzenie', 'Aktywność z tytułem, kategorią oraz godziną rozpoczęcia i zakończenia.'),
        ('Kategoria wydarzenia', 'Rodzaj wpisu, np. zajęcia, praca albo aktywność prywatna.'),
        ('Zajęcia obowiązkowe', 'Zajęcia wyłączone z czasu dostępnego do planowania pracy.'),
        ('Seria tygodniowa', 'Reguła, według której wydarzenie ma wystąpienia w kolejnych tygodniach.'),
        ('Kolizja terminów', 'Nakładanie się przedziałów czasu dwóch wydarzeń.'),
        ('Plan zajęć', 'Zestaw wydarzeń akademickich studenta w określonym okresie.'),
        ('Import', 'Wprowadzenie wydarzeń ze źródła zewnętrznego po podglądzie i decyzji użytkownika.'),
        ('Podgląd importu', 'Tymczasowa lista rozpoznanych danych przed ich zatwierdzeniem.'),
        ('Duplikat', 'Wpis uznany za równoważny istniejącemu według przyjętej reguły porównania.'),
        ('Dostępność do pracy', 'Dni i godziny, w których student może podjąć pracę.'),
        ('Dzień niedostępny', 'Dzień lub okres wyłączony z planowania grafiku.'),
        ('Cel godzinowy', 'Liczba godzin pracy, którą student chce osiągnąć w danym okresie.'),
        ('Limit godzin', 'Maksymalna liczba godzin pracy, której planer nie powinien przekraczać.'),
        ('Stawka godzinowa', 'Kwota wynagrodzenia przypisana jednej godzinie pracy.'),
        ('Bufor dojazdu', 'Czas uwzględniany na dojazd przed lub po zmianie.'),
        ('Odpoczynek', 'Odstęp między zmianami wymagany przez preferencje studenta.'),
        ('Zmiana robocza', 'Blok pracy z datą, początkiem i końcem.'),
        ('Propozycja grafiku', 'Wynik planera przedstawiony do korekty i decyzji użytkownika.'),
        ('Wykonalność celu', 'Informacja, czy cel godzin da się osiągnąć przy podanych ograniczeniach.'),
        ('Akceptacja grafiku', 'Jawna decyzja studenta o zachowaniu zaproponowanych zmian.'),
        ('Kalendarz zewnętrzny', 'Kalendarz poza KAC, z którego można pobierać lub do którego można publikować wydarzenia po udzieleniu zgody.'),
        ('Publikacja grafiku', 'Dodanie zaakceptowanych zmian do wybranego kalendarza docelowego.'),
        ('Godziny ciszy', 'Przedział czasu, w którym powiadomienia są blokowane.'),
        ('Przypomnienie', 'Informacja kierowana do użytkownika przed wydarzeniem lub zmianą.'),
        ('Powiadomienie o konflikcie', 'Informacja o nakładających się terminach.'),
    ]
    doc = base_doc('Słownik pojęć KAC', 'KAC-A6', 'Wspólna terminologia domeny planowania czasu studenta')
    note(doc, 'Zakres', 'Słownik opisuje pojęcia domenowe. Nazwy technologii, baz danych, API i bibliotek nie stanowią jego haseł.')
    h(doc, '1. Pojęcia i definicje')
    word_table(doc, ['Nazwa pojęcia', 'Znaczenie w KAC'], terms, font_size=8)
    h(doc, '2. Zasady używania')
    for x in [
        'Rozróżniać wydarzenie, kategorię, serię i pojedyncze wystąpienie.',
        'Rozróżniać zmianę roboczą, propozycję grafiku, grafik zaakceptowany i grafik opublikowany.',
        'Kalendarz zewnętrzny jest źródłem/docelowym obszarem danych, a nie kontem użytkownika KAC.',
        'Kolor nie jest jedynym nośnikiem informacji o obowiązkowości lub konflikcie.',
    ]:
        bullet(doc, x)
    return doc


def write_traceability_xlsx(rows, stories, epics):
    wb = Workbook()
    ws = wb.active
    ws.title = 'Rejestr Jira'
    headers = ['Klucz', 'Typ', 'Epik', 'Podsumowanie', 'Status snapshotu', 'Priorytet', 'WBS / pakiet']
    ws.append(headers)
    for row in rows:
        key = row.get('Klucz zgłoszenia', '')
        issue_type = row.get('Typ zgłoszenia', '')
        parent = row.get('Pole własne (Łącze epiki)', '') or ''
        epn = int(parent.rsplit('-', 1)[-1]) if parent and issue_type == 'Historyjka' else int(key.rsplit('-', 1)[-1]) if issue_type == 'Epika' else 0
        epic_name = epics.get(parent, row.get('Podsumowanie', '')) if issue_type == 'Historyjka' else row.get('Podsumowanie', '')
        wbs = EPIC_TO_WBS.get(epn, 'A1–E4') if issue_type == 'Historyjka' else 'A1–E4'
        ws.append([key, issue_type, epic_name, (row.get('Podsumowanie', '') or '').strip(), row.get('Status', ''), row.get('Priorytet', ''), wbs])
    navy = PatternFill('solid', fgColor=NAVY)
    status_fill = PatternFill('solid', fgColor='E2F0D9')
    light = PatternFill('solid', fgColor='F4F7FA')
    thin = Side(style='thin', color='D8DEE6')
    for c in ws[1]:
        c.fill = navy
        c.font = Font(bold=True, color='FFFFFF')
        c.alignment = Alignment(wrap_text=True, vertical='center')
    for r in range(2, ws.max_row + 1):
        for c in ws[r]:
            c.alignment = Alignment(wrap_text=True, vertical='top')
            c.border = Border(bottom=thin)
            if r % 2 == 0:
                c.fill = light
        if ws.cell(r, 5).value == 'W toku':
            ws.cell(r, 5).fill = status_fill
            ws.cell(r, 5).font = Font(bold=True, color='38761D')
    for col, width in zip('ABCDEFG', [24, 15, 52, 70, 20, 14, 16]):
        ws.column_dimensions[col].width = width
    ws.freeze_panes = 'A2'
    ws.auto_filter.ref = f'A1:G{ws.max_row}'
    ws.sheet_view.showGridLines = False
    ws.row_dimensions[1].height = 28

    schedule = wb.create_sheet('Gantt RUP')
    header = ['WBS', 'Faza RUP', 'Iteracja / dyscyplina', 'Zadanie', 'Rola wiodąca', 'Start', 'Czas', 'Poprzedniki', 'Klucze Jira', 'Produkt / kryterium'] + [f'T{i}' for i in range(1, 14)]
    schedule.append(header)
    phases = {1: 'Incepcja', 2: 'Doprecyzowanie', 3: 'Budowa', 4: 'Przekazanie'}
    gantt_tasks = [
        ('A1', 1, 'Zarządzanie projektem (Project Management)', 'Spotkanie rozpoczynające, uzgodnienie zakresu i kanału decyzji', 'Scrum Master; Właściciel produktu', 1, 1, '', 'wszystkie epiki', 'Karta celu, właściciele decyzji'),
        ('A2', 1, 'Wymagania (Requirements)', 'Analiza 49 historii i 6 epik; rejestr zakresu, statusów i ryzyk', 'Analityk wymagań; Scrum Master', 1, 2, 'A1', '49 historii', 'Matryca śledzenia Jira'),
        ('A3', 1, 'Modelowanie biznesowe (Business Modeling)', 'Problematyka, użytkownicy, procesy i słownik domenowy', 'Analityk biznesowy; Właściciel produktu', 1, 2, 'A1', 'E1–E6', 'Dokumenty A1–A6'),
        ('A4', 1, 'Zarządzanie projektem (Project Management)', 'Baza planu Incepcji, RUP, role, ryzyka i bramki odbioru', 'Scrum Master; Recenzent projektu', 2, 1, 'A2,A3', 'wszystkie epiki', 'Zatwierdzona wizja i plan — M1'),
        ('E1', 2, 'Wymagania (Requirements)', 'Szczegółowe scenariusze i kryteria akceptacji dla wydarzeń/kolizji', 'Analityk; Projektant interfejsu; tester', 3, 2, 'A4', 'Epik 1', 'Kryteria E1 i dostępność'),
        ('E2', 2, 'Analiza i projektowanie (Analysis & Design)', 'Model domeny, importu i planera; rozstrzygnięcia uwierzytelniania/SQL/API/Redis', 'Architekt; analityk; integrator', 3, 2, 'A4', 'Epiki 2–4; rozszerzenie logowania', 'Baza architektury — M2'),
        ('E3', 2, 'Testowanie (Test)', 'Plan testów mobilnych, czasu/DST, importu, konfliktów i publikacji', 'Kierownik testów; tester; Właściciel produktu', 4, 1, 'E1,E2', 'Epiki 1–6', 'Plan akceptacji'),
        ('C1', 3, 'Iteracja C1 — kalendarz', 'Widok tygodnia, wydarzenia, kategorie, serie i obowiązkowość', 'Zespół programistyczny; tester', 5, 2, 'E3', 'Epik 1', '14 historii kalendarza'),
        ('C2', 3, 'Iteracja C2 — import', 'Import, podgląd, korekta, deduplikacja i obsługa błędów plików', 'Zespół programistyczny; analityk; tester', 7, 2, 'C1', 'Epik 2', '7 historii importowych'),
        ('C3', 3, 'Iteracja C2 — preferencje', 'Profil, dostępność, cel, limit, stawka, odpoczynek i dojazd', 'Zespół programistyczny; tester', 7, 2, 'E2,C1', 'Epik 3', '7 historii preferencji'),
        ('C4', 3, 'Iteracja C3 — planer', 'Generowanie, test wykonalności, ręczna edycja i akceptacja', 'Zespół programistyczny; Właściciel produktu; tester', 9, 2, 'C2,C3', 'Epik 4', '7 historii planowania'),
        ('C5', 3, 'Iteracja C3 — Google', 'Połączenie, wybór kalendarza, publikacja, aktualizacja i cofnięcie zgody', 'Integrator; Zespół programistyczny; tester', 9, 3, 'E2,C4', 'Epik 5', '7 historii synchronizacji'),
        ('C6', 3, 'Iteracja C3 — powiadomienia', 'Przypomnienia, cisza, konflikty, limit i brak możliwości celu', 'Zespół programistyczny; tester', 10, 2, 'C4', 'Epik 6', '7 historii powiadomień'),
        ('C7', 3, 'Testy / zarządzanie konfiguracją', 'Integracja, regresja, bezpieczeństwo, baza wersji i kontrola defektów', 'Kierownik testów; Kierownik konfiguracji', 10, 2, 'C2,C3,C4,C5,C6', 'E1–E6', 'Kandydat do odbioru — M3'),
        ('T1', 4, 'Testy akceptacyjne (UAT)', 'Testy z użytkownikami, urządzenia mobilne/desktop i poprawki blokujące', 'Właściciel produktu; Scrum Master; tester', 12, 1, 'C7', 'E1–E6', 'Akceptacja — M4'),
        ('T2', 4, 'Wdrożenie (Deployment)', 'Dokumentacja, szkolenie, informacje o wydaniu i przygotowanie wdrożenia', 'Kierownik wdrożenia; Redaktor techniczny', 12, 2, 'T1', 'E1–E6', 'Pakiet przekazania'),
        ('T3', 4, 'Zarządzanie projektem (Project Management)', 'Odbiór, przegląd, raport końcowy i publikacja SharePoint', 'Scrum Master; Recenzent projektu', 13, 1, 'T2', 'E1–E6', 'Odbiór — M5; raport wysyła Scrum Master'),
    ]
    for wbs, phase_num, discipline, name, role, start, duration, predecessors, key_text, output in gantt_tasks:
        values = [wbs, phases[phase_num], discipline, name, role, f'T{start}', f'{duration} tyg.', predecessors, key_text, output] + [''] * 13
        for week in range(start, start + duration):
            if 1 <= week <= 13:
                values[9 + week] = '■'
        schedule.append(values)
    phase_color = {1: 'D9EAF7', 2: 'E4DFEC', 3: 'E2F0D9', 4: 'FCE4D6'}
    for c in schedule[1]:
        c.fill = navy
        c.font = Font(bold=True, color='FFFFFF', size=8)
        c.alignment = Alignment(wrap_text=True, horizontal='center', vertical='center')
    for i, task in enumerate(gantt_tasks, start=2):
        fill = PatternFill('solid', fgColor=phase_color[task[1]])
        for col in range(1, 11):
            cell = schedule.cell(i, col)
            cell.fill = fill if col <= 2 else (light if i % 2 == 0 else PatternFill(fill_type=None))
            cell.alignment = Alignment(wrap_text=True, vertical='top')
            cell.border = Border(bottom=thin)
        for week in range(task[5], task[5] + task[6]):
            c = schedule.cell(i, 10 + week)
            c.fill = fill
            c.value = '■'
            c.font = Font(bold=True, color=NAVY)
            c.alignment = Alignment(horizontal='center')
    widths = [9, 23, 31, 60, 45, 12, 13, 18, 25, 48]
    for i, width in enumerate(widths, start=1):
        schedule.column_dimensions[get_column_letter(i)].width = width
    for i in range(11, 24):
        schedule.column_dimensions[get_column_letter(i)].width = 5
    schedule.freeze_panes = 'K2'
    schedule.auto_filter.ref = f'A1:W{schedule.max_row}'
    schedule.sheet_view.showGridLines = False
    schedule.row_dimensions[1].height = 34
    for i in range(2, schedule.max_row + 1):
        schedule.row_dimensions[i].height = 42

    resources = wb.create_sheet('Zasoby')
    resources.append(['Rola / zasób', 'Odpowiedzialność', 'Faza', 'Obsada / uwaga'])
    resource_rows = [
        ('Scrum Master / Kierownik projektu', 'Plan, ryzyka, status i raportowanie; jedyny nadawca raportu do SharePoint.', 'Wszystkie', 'Nazwisko i dostępność do uzupełnienia.'),
        ('Właściciel produktu / przedstawiciel WAT', 'Priorytety, decyzje i kryteria akceptacji.', 'Incepcja, przegląd, testy akceptacyjne', 'Osoba formalna do wskazania.'),
        ('Analityk biznesowy / wymagań', 'Procesy, słownik, historyjki, kryteria i powiązanie z Jira.', 'Incepcja, Doprecyzowanie', 'Rola z szablonu RUP.'),
        ('Architekt rozwiązania', 'Model domeny, uwierzytelnianie, API/persistencja i integracje.', 'Doprecyzowanie', 'Rekomendacje do zatwierdzenia.'),
        ('Projektant interfejsu UI/UX', 'Responsywne widoki, importer i przepływy użytkownika.', 'Doprecyzowanie, Budowa', 'Obsługa telefonu i komputera.'),
        ('Zespół programistyczny', 'Kalendarz, import, planer, integracje i poprawki.', 'Budowa', 'Liczba osób i przepustowość do uzupełnienia.'),
        ('Integrator Google / importów', 'OAuth, interfejs Google Calendar, formaty plików i OCR.', 'Doprecyzowanie, Budowa', 'Wymaga poświadczeń i wyboru zakresów.'),
        ('Kierownik testów / tester', 'Testy scenariuszy, zmiany czasu, konfliktów, importów i akceptacji.', 'Doprecyzowanie–Przekazanie', 'Checklistę przypadków użycia oprzeć o Lista_kontrolna.xls.'),
        ('Kierownik konfiguracji', 'Wersje, zatwierdzona baza wymagań i kontrola zmian.', 'Wszystkie', 'Rola z puli zasobów MPP.'),
        ('Kierownik wdrożenia / redaktor techniczny', 'Wdrożenie, instrukcje i informacje o wydaniu.', 'Przekazanie', 'Rola z puli zasobów MPP.'),
    ]
    for row in resource_rows:
        resources.append(row)
    team_sheet = wb.create_sheet('Zespół')
    team_sheet.append(['Imię i nazwisko', 'Rola na zrzucie uprawnień', 'Rola RUP / projektowa', 'Uwagi'])
    for name, platform_role in TEAM_MEMBERS:
        team_sheet.append([name, platform_role, 'Do przydzielenia', 'Rola platformowa nie przesądza o odpowiedzialności Scrum/RUP.'])
    team_sheet.append(['Scrum Master', 'Nie wskazano na zrzucie', 'Do wskazania spośród zespołu', 'Tylko Scrum Master przekazuje raport do SharePoint.'])
    team_sheet.append(['Lider projektu w eksporcie Jira', 'Jira zawiera oddzielne pole lidera', 'Do uzgodnienia', 'Nie utożsamiono go z właścicielem witryny ani Scrum Masterem.'])
    milestone = wb.create_sheet('Kamienie milowe')
    milestone.append(['ID', 'Kamień milowy', 'Termin względny', 'Dowód / akceptujący'])
    for row in [
        ('M1', 'Zakres i wizja KAC zatwierdzone', 'Koniec T2', 'Właściciel produktu + Scrum Master'),
        ('M2', 'Wymagania i architektura integracji uzgodnione', 'Koniec T5', 'Recenzent projektu + właściciele integracji'),
        ('M3', 'Funkcje E1–E6 gotowe do odbioru', 'Koniec T11', 'Kierownik testów + Właściciel produktu'),
        ('M4', 'Testy akceptacyjne i poprawki krytyczne zamknięte', 'Koniec T12', 'Reprezentanci studentów + Właściciel produktu'),
        ('M5', 'Przekazanie/raport końcowy', 'Koniec T13', 'Raport wysyła wyłącznie Scrum Master'),
    ]:
        milestone.append(row)
    assumptions = wb.create_sheet('Założenia')
    assumptions.append(['Założenie / bramka', 'Treść'])
    for row in [
        ('Źródło', 'CSV Jira zawiera 55 rekordów: 49 historii i 6 epików; statusy zapisano jako migawkę z 11.10.2026.'),
        ('Horyzont', '13 tygodni względnych od rozpoczęcia projektu, bez dat kalendarzowych, bo nie podano startu ani dostępności zespołu.'),
        ('RUP', 'Incepcja T1–2; Doprecyzowanie T3–4; Budowa T5–11 (iteracje); Przekazanie T12–13.'),
        ('MPP', 'RUP_Project.mpp zawiera 690 zadań przykładowych i daty z 2005 r.; użyto struktury/roli, nie starych dat.'),
        ('Makieta', 'Aplikacja obecnie jest makietą. Nie należy utożsamiać scenariuszy symulowanych z produkcyjnym API, SQL, Redis, OAuth, OCR ani wysyłką powiadomień.'),
        ('Auth', 'Późniejsze wymaganie rejestracji/logowania/onboardingu należy zapisać w Jira jako nowe historie.'),
        ('Raport', 'Wyniki i plan do witryny SharePoint przekazuje Scrum Master; brak dostępu i adresu witryny, więc nie opublikowano.'),
        ('Lista_kontrolna.xls', 'Arkusze dotyczą kontroli jakości przypadków użycia; będą bramką przeglądu scenariuszy, nie harmonogramem ani checklistą wszystkich artefaktów.'),
        ('Role RUP', 'Zasoby są nazwami ról, nie konkretnych osób. Przydział i nakład pracy do uzupełnienia po potwierdzeniu zespołu.'),
    ]:
        assumptions.append(row)
    for sheet in wb.worksheets:
        sheet.sheet_view.showGridLines = False
        for cell in sheet[1]:
            cell.fill = navy
            cell.font = Font(bold=True, color='FFFFFF')
            cell.alignment = Alignment(wrap_text=True, vertical='center')
        sheet.freeze_panes = 'A2'
        for row in sheet.iter_rows(min_row=2):
            for cell in row:
                cell.alignment = Alignment(wrap_text=True, vertical='top')
                cell.border = Border(bottom=thin)
    for col, width in zip('ABCD', [34, 80, 33, 64]):
        resources.column_dimensions[col].width = width
        milestone.column_dimensions[col].width = width
        team_sheet.column_dimensions[col].width = width
    assumptions.column_dimensions['A'].width = 32
    assumptions.column_dimensions['B'].width = 130
    out = ROOT / '04_Wstepny_harmonogram_RUP_KAC.xlsx'
    wb.save(out)
    return gantt_tasks, out


def register_pdf_fonts():
    fonts = Path(r'C:\Windows\Fonts')
    normal = fonts / 'arial.ttf'
    bold = fonts / 'arialbd.ttf'
    if normal.exists() and bold.exists():
        pdfmetrics.registerFont(TTFont('ArialKAC', str(normal)))
        pdfmetrics.registerFont(TTFont('ArialKAC-Bold', str(bold)))
        return 'ArialKAC', 'ArialKAC-Bold'
    return 'Helvetica', 'Helvetica-Bold'


def build_gantt_pdf(gantt_tasks):
    normal_font, bold_font = register_pdf_fonts()
    out = ROOT / '04_Wstepny_harmonogram_RUP_KAC.pdf'
    doc = SimpleDocTemplate(str(out), pagesize=landscape(A3), rightMargin=10*mm, leftMargin=10*mm, topMargin=10*mm, bottomMargin=10*mm)
    base = getSampleStyleSheet()
    title = ParagraphStyle('PLTitle', parent=base['Title'], fontName=bold_font, fontSize=16, leading=19, textColor=colors.HexColor('#1F4E78'), alignment=1, spaceAfter=5)
    body = ParagraphStyle('PLBody', parent=base['BodyText'], fontName=normal_font, fontSize=7, leading=8)
    small = ParagraphStyle('PLSmall', parent=body, fontSize=5.8, leading=6.6)
    data = [[Paragraph(str(x), small) for x in ['WBS', 'Faza RUP', 'Zadanie', 'Rola wiodąca', 'Start', 'Czas'] + [f'T{i}' for i in range(1, 14)]]]
    phases = {1: 'Incepcja', 2: 'Doprecyzowanie', 3: 'Budowa', 4: 'Przekazanie'}
    for wbs, phase_num, discipline, name, role, start, duration, predecessors, key_text, output in gantt_tasks:
        row = [wbs, phases[phase_num], f'{discipline}: {name}', role, f'T{start}', f'{duration} tyg.']
        row.extend(['■' if start <= week < start + duration else '' for week in range(1, 14)])
        data.append([Paragraph(str(x), small) for x in row])
    fixed = [10*mm, 26*mm, 91*mm, 77*mm, 12*mm, 14*mm]
    available_width = landscape(A3)[0] - 20*mm
    remaining = available_width - sum(fixed)
    widths = fixed + [remaining/13]*13
    table = Table(data, colWidths=widths, repeatRows=1)
    phase_colors = {1: colors.HexColor('#D9EAF7'), 2: colors.HexColor('#E4DFEC'), 3: colors.HexColor('#E2F0D9'), 4: colors.HexColor('#FCE4D6')}
    commands = [
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1F4E78')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), bold_font),
        ('GRID', (0, 0), (-1, -1), 0.25, colors.HexColor('#C6D1DC')),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('ALIGN', (6, 0), (-1, -1), 'CENTER'),
        ('LEFTPADDING', (0, 0), (-1, -1), 2), ('RIGHTPADDING', (0, 0), (-1, -1), 2),
        ('TOPPADDING', (0, 0), (-1, -1), 2), ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
    ]
    for idx, task in enumerate(gantt_tasks, start=1):
        fill = phase_colors[task[1]]
        commands.append(('BACKGROUND', (0, idx), (1, idx), fill))
        for week in range(task[5], task[5] + task[6]):
            if 1 <= week <= 13:
                commands.append(('BACKGROUND', (5 + week, idx), (5 + week, idx), fill))
                commands.append(('TEXTCOLOR', (5 + week, idx), (5 + week, idx), colors.HexColor('#1F4E78')))
                commands.append(('FONTNAME', (5 + week, idx), (5 + week, idx), bold_font))
    table.setStyle(TableStyle(commands))
    team_names = ', '.join(name for name, _ in TEAM_MEMBERS)
    story = [Paragraph('Wstępny harmonogram RUP — KAC', title), Paragraph(f'13 tygodni względnych od rozpoczęcia. Migawka Jira: {SNAPSHOT}. Daty kalendarzowe i obsadę należy ustalić z zespołem.', body), Spacer(1, 4*mm), table, Spacer(1, 5*mm), Paragraph(f'Zespół widoczny na zrzucie uprawnień: {team_names}. Widoczne role Właściciel/Współwłaściciel nie są przypisaniami RUP; Scrum Master do wskazania.', body), Spacer(1, 2*mm), Paragraph('Raport statusu do SharePoint wysyła wyłącznie Scrum Master. Pełna matryca 49 historii, zasobów, kamieni milowych i założeń: arkusz XLSX.', body)]
    doc.build(story)
    return out


def build_readme(rows, stories, parse_count):
    status = Counter(s['status'] for s in stories)
    story_count = len(stories)
    text = f'''# Dokumentacja Etapu A — KAC

Data przygotowania: {DOC_DATE}. Źródło backlogu: `Jira 2026-10-11T16_53_41+0200.csv` (migawka {SNAPSHOT}).

## Artefakty do przekazania

1. `01_Przedstawienie_problemu_Zamawiajacego_KAC.docx/.pdf` — problem, użytkownicy i oczekiwany zakres.
2. `02_Przedstawienie_problemu_Wykonawcy_KAC.docx/.pdf` — analiza domeny, granic, ryzyk i rozbieżności backlogu.
3. `03_Wizja_projektu_KAC.docx/.pdf` — wizja produktu, interesariusze, możliwości, ograniczenia i decyzje.
4. `04_Wstepny_harmonogram_RUP_KAC.xlsx/.pdf` — Gantt 13 tygodni względnych; pełny rejestr w arkuszu „Rejestr Jira”, a skład w arkuszu „Zespół”.
5. `05_Analiza_lingwistyczna_Jira_KAC.docx/.pdf` — kolorowane zdania użytkownika, osobne tabele grup czasownikowych/rzeczownikowych i opisowo wyprowadzeni kandydaci na obiekty.
6. `06_Slownik_pojec_KAC.docx/.pdf` — słownik pojęć domeny kalendarza studenta, bez technologii.
7. `generuj_dokumenty_kac.py` — skrypt odtwarzający DOCX, XLSX i Gantt PDF z lokalnego CSV Jira.

## Analiza CSV

- Rekordy: {len(rows)}; historyjki: {story_count}; epiki: 6.
- Status historyjek w eksporcie: {status.get('W toku', 0)} „W toku”, {status.get('Do zrobienia', 0)} „Do zrobienia”. To migawka z 11.10.2026, nie bieżący status.
- Udało się wyodrębnić zdanie „Jako–chcę–aby” z {parse_count}/{story_count} historyjek. W pozostałych przypadkach kolorowana jest nazwa akcji ze zgłoszenia.

## Zespół

Skład przepisany ze zrzutu uprawnień przekazanego przez Zamawiającego:

| Osoba | Rola widoczna na zrzucie |
|---|---|
{chr(10).join(f'| {name} | {role} |' for name, role in TEAM_MEMBERS)}

„Właściciel/Współwłaściciel” oznacza rolę platformową, nie rolę Scrum/RUP. Eksport Jira zawiera osobne pole lidera projektu. Scrum Master nie jest wskazany na zrzucie; należy wyznaczyć go przed przypisaniem raportowania. Nie przypisano osobom ról w harmonogramie bez potwierdzenia kompetencji i dostępności.

## Granica mock/prod

Dokumenty rozróżniają istniejącą makietę (stan pamięciowy, symulowane importy/synchronizacja/powiadomienia) od wymagań Jira zawierających prawdziwą autoryzację, API, SQL/Redis lub Google Calendar. Wnioski auth/onboardingu zgłoszone po eksporcie CSV są odnotowane jako brakujące historyjki Jira.

## Uwagi organizacyjne

- Wyeksportowany MPP ma szablon RUP z historycznymi datami 2005; użyto go wyłącznie do nazw faz, ról i dyscyplin. Harmonogram KAC jest propozycją 13 tygodni od startu i nie używa przestarzałych dat.
- `Lista_kontrolna.xls` jest checklistą jakości przypadków użycia; traktujemy ją jako bramkę przeglądu, nie jako specyfikację produktu.
- Raport do SharePoint przesyła tylko Scrum Master. Brak adresu witryny i uprawnień oznacza, że plików nie opublikowano.
'''
    (ROOT / '00_README_artefakty.md').write_text(text, encoding='utf-8')


def main():
    ROOT.mkdir(parents=True, exist_ok=True)
    rows, stories, epics = load_jira()
    epic_count = sum(1 for r in rows if r.get('Typ zgłoszenia') == 'Epika')
    if len(rows) != 55 or len(stories) != 49 or epic_count != 6:
        raise RuntimeError(f'Nieoczekiwany eksport Jira: {len(rows)} rekordów, {len(stories)} historyjek, {epic_count} epików.')
    parse_count = sum(1 for s in stories if s['parsed'])
    build_problem_customer(rows, stories, epics).save(ROOT / '01_Przedstawienie_problemu_Zamawiajacego_KAC.docx')
    build_problem_contractor(rows, stories, epics).save(ROOT / '02_Przedstawienie_problemu_Wykonawcy_KAC.docx')
    build_vision_kac(stories, epics).save(ROOT / '03_Wizja_projektu_KAC.docx')
    gantt_tasks, _ = write_traceability_xlsx(rows, stories, epics)
    build_gantt_pdf(gantt_tasks)
    build_linguistic_analysis(stories).save(ROOT / '05_Analiza_lingwistyczna_Jira_KAC.docx')
    build_glossary().save(ROOT / '06_Slownik_pojec_KAC.docx')
    build_readme(rows, stories, parse_count)
    print(f'Jira: {len(rows)} rekordów; {len(stories)} historii; {epic_count} epików; {parse_count} zdań Jako–chcę–aby odczytanych.')
    print(f'Pliki zapisano w {ROOT}')


if __name__ == '__main__':
    main()
