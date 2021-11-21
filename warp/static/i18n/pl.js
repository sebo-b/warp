
warpGlobals.i18n = { locale: 'pl' }

warpGlobals.i18n.weekdaysShort = ['niedz.','pon.','wt.','śr.','czw.','pt.','sob.'];

warpGlobals.i18n.datePicker = {
    firstDay: 1,    //first day of week
    i18n_object: {
        cancel:	'Anuluj',
        clear: 'Wyczyść',
        done: 'Ok',
        previousMonth: '‹',
        nextMonth: '›',
        months: ['styczeń','luty','marzec','kwiecień','maj','czerwiec','lipiec','sierpień','wrzesień','październik','listopad','grudzień'],
        monthsShort: ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'],
        weekdays: ['niedziela','poniedziałek','wtorek','środa','czwartek','piątek','sobota'],
        weekdaysShort: warpGlobals.i18n.weekdaysShort,
        weekdaysAbbrev:['N','P','W','Ś','C','P','S'],
    },
};

warpGlobals.i18n.tabulatorLangs = {
    "default": {    //keep default, so setting locale is not needed
        "groups":{
            "item":"element",
            "items":"elementy/ów",
        },
        "columns":{
        },
        "data":{
            "loading":"",   //just spinner is shown
            "error":"Błąd",
        },
        "pagination":{
            "page_size":"Rozmiar strony",
            "page_title":"Pokaż stronę",
            "first":"|«",
            "first_title":"Pierwsza strona",
            "last":"»|",
            "last_title":"Ostatnia strona",
            "prev":"«",
            "prev_title":"Poprzednia strona",
            "next":"»",
            "next_title":"Następna strona",
            "all":"Wszystkie",
        },
        "headerFilters":{
            "default":"Filtruj",
            "columns":{}
        }
    }
};

warpGlobals.i18n.phrases = {
    btn: {
        "Login": "Zaloguj",
        "Add": "Dodaj",
        "Cancel": "Anuluj",
        "Delete": "Usuń",
        "Save": "Zapisz",
        'Yes': "Tak",
        'No': 'Nie',
        'Ok': 'Ok',
        'Set': "Ustaw",
        "YES, I'M SURE": "TAK, JESTEM PEWIEN",
        "Generate password": "Wygeneruj hasło",
        "Book": "Rezerwuj",
        "Update": "Uaktualnij",
        "Remove": "Zwolnij",
        "Assign": "Przypisz",
        "Enable": "Włącz",
        "Disable": "Wyłącz",
        "Upload map": "Wczytaj mapę",
        "Add seats": "Dodaj miejsca",
        "Done adding": "Zakończ",
        "Restore": "Przywróć",
        "Align all": "Dopasuj wsz.",
        "Finish alignment": "Zakończ",
    },
    'Password': 'Hasło',
    'Bookings': 'Rezerwacje',
    'Report': 'Raport',
    'Users': 'Użytkownicy',
    'Groups': 'Grupy',
    'User name': 'Nazwisko',
    'Zone': 'Strefa',
    'Seat': 'Miejsce',
    'Time': 'Czas',
    'Login': 'Login',
    'From': 'Od',
    'To': 'Do',
    'Type': 'Typ',
    'Group id': 'Id grupy',
    'Group name': 'Nazwa',
    "Group name cannot be empty.": "Nazwa grupy nie może być pusta",
    "Are you sure to delete group: %{group}": "Czy na pewno chcesz usunąć grupę: %{group}",
    "Select user": "Wybierz użytkownika",
    'Members of: %{group}': 'Członkowie grupy: %{group}',
    "Are you sure to remove %{user} from group %{group}?": "Czy na pewno chcesz usunąć użytkownika %{user} z grupy %{group}?",
    "Add to group %{group}": "Dodaj do grupy %{group}",
    'Action successfull.': 'Zmiany wprowadzono.',
    'Error': 'Błąd',
    'Something went wrong (status=%{status}).': 'Inny błąd (status=%{status}).',
    'Other error.': 'Inny błąd',
    'Are you sure to delete this booking?': 'Czy na pewno usunąć tę rezerwację?',
    "Are you sure?": "Czy jesteś pewien?",
    "Account type": "Rodzaj konta",
    "Retype password": "Powtórz hasło",
    accountTypes: {
        "Admin": "Administrator",
        "User": "Użytkownik",
        "BLOCKED": "KONTO ZABLOKOWANE",
    },
    "Passwords don't match": "Hasła się nie zgadzają",
    "Name cannot be empty.": "Nazwisko nie może być puste",
    "All fields are mandatory": "Wszystkie pola są wymagane",
    "ARE YOU SURE TO DELETE USER: %{user}?": "CZY JESTEŚ PEWIEN, ŻE CHCESZ USUNĄĆ UŻYTKOWNIKA: %{user}?",
    "User has XXX bookin(s) ... ":
        "Użytkownik ma jedną rezerwację w przeszłości. Usunięcie tego użytkownika spowoduje usunięcie tej rezerwacji z raportu.||||"+
        "Użytkownik ma %{smart_count} rezerwacje w przeszłości. Usunięcie tego użytkownika spowoduje usunięcie tych rezerwacji z raportu.||||"+
        "Użytkownik ma %{smart_count} rezerwacji w przeszłości. Usunięcie tego użytkownika spowoduje usunięcie tych rezerwacji z raportu.",
    "You will delete the log of user's past bookings. It is usually a better idea to BLOCK the user.":
        "Usuniesz również historię rezerwacji tego użytkownika. Z tego powodu zaleca się zablokowanie konta zamiast usuwania.",
    "Are you sure to delete user: %{user}": "Czy jesteś pewien, że chcesz usunąć użytkownika: %{user}",
    "Select users to which the seat will be assigned:": "Wybierz użytkowników, do których zostanie przypisane miejce:",
    "The seat is available to be booked on the selected dates and time.":
        "Miejce jest dostępne do zarezerwowania w wybranym czasie",
    "The seat is available to be booked on the selected dates and time. However, you have other bookings at that time which will be automatically updated.":
        "Miejce jest dostępne do zarezerwowania w wybranym czasie, jednak posiadasz inne rezerwacje w tym samym czasie, które zostaną automatycznie usunięte.",
    "The seat is booked by another person or not available.":
        "Miejsce jest zarezerwowane przez inną osobą lub niedostępne",
    "The seat is booked by you on the selected date and time.":
        "W wybranym czasie miejsce jest zarezerwowane przez Ciebie.",
    "The seat is booked by you, but not exactly on the selected date or time. You can update booking, all your other reservations at that time will be automatically updated.":
        "Miejsce jest zarezerwowane przez Ciebie, jednak nie w wybranym czasie. Możesz uaktualnić rezerwację, wszystkie Twoje inne rezerwacje w wybranym czasie zostaną uaktualnione",
    "The seat is booked by you, but not exactly on the selected date or time. You CANNOT update the booking as it is conflicting with another user booking.":
        "Miejsce jest zarezerwowane przez Ciebie, jednak nie w wybranym czasie. NIE możesz uaktualnić rezerwacji, ponieważ inni użytkownicy maja rezerwacje w wybranym czasie.",
    "The same meaning as the green type icon, but the seat is assigned to you, not assigned people cannot book it. Note that assignment isn't necessarily exclusive, the seat can be assigned to more than one person.":
        "To samo znaczenie co zielona ikona, jednak miejsce jest przypisane do Ciebie, więc inne osoby nie mogą go zająć (chyba, że również do nich to miejsce jest przypisane).",
    "The same meaning as the green type icon, but the seat is assigned to you, not assigned people cannot book it. Note that assignment isn't necessarily exclusive, the seat can be assigned to more than one person.":
        "To samo znaczenie co zielona ikona, jednak miejsce jest przypisane do Ciebie, więc inne osoby nie mogą go zająć (chyba, że również do nich to miejsce jest przypisane).",
    "The seat is disabled, cannot be booked, and is not visible to non-admins.":
        "Miejce jest wyłączone, nie może zostać zarezerwowane i nie jest widoczne dla zwykłych użytkowników. ",
    "The seat is assigned to some people. This status is visible only to admins. Note that you won't see this icon if the seat is assigned to you.":
        "Miejsce jest przypisane do użytkowników. Ten status jest widoczny tylko dla administratora, nie zobaczysz tej ikony jeśli miejsce jest przypisane do Ciebie",
    "Book as": "Zarezerwuj jako",
    "Seat %{seat_name}": "Miejsce %{seat_name}",
    "Assigned to:": "Przypisane do:",
    "Bookings:": "Rezerwacje:",
    "Seat %{seat_name} to be booked:": "Miejsce %{seat_name} zostanie zarezerwowane:",
    "To be removed:": "Rezerwacje zostaną usunięte:",
    "Seat is successfully disabled.<br>However there are existing reservations in the the next few weeks. Existing reservations are not automatically removed, it has to be done manually.<br><br>":
        "Miejsce zostało wyłączone.<br>Jednak w kolejnych dniach istnieją jego rezerwacje. Istniejące rezerwacje nie są usuwane automatycznie, należy usunąć je ręcznie.<br><br>",
    "Seat is successfully assigned.<br>However there are non-assignees' existing reservations in the the next few weeks. Existing reservations are not automatically removed, it has to be done manually.<br><br>":
        "Miejsce zostało przypisane.<br>Jednak w kolejnych dniach istnieję rezerwacje zrobione przez osoby, które nie zostały do niego przypisane. Istniejące rezerwacje nie są usuwane automatycznie, należy usunąć je ręcznie.<br><br>",
    "Warning": "Uwaga",
    "Change unsuccessfull": "Zmian nie wprowadzono",
    "Zones": "Strefy",
    "Zone name": "Nazwa",
    "Zone group": "Grupa",
    "Num of admins": "Adm.",
    "Num of users": "Użytkownicy",
    "Num of viewers": "Użytk. z ogr.",
    "Manage users": "Zarządzaj użytkownikami",
    'Edit zone': "Edytuj",
    'Edit map': "Edytuj mapę",
    "You will delete the log of all past bookings in this zone. It is usually a better idea to unassign all users from the zone to make it inaccessible.":
        "Usuniesz również historię rezerwacji w tej strefie. Z tego powodu zamiast usuwania strefy zaleca się usunięcie z niej wszystkich użytkowników, co spowoduje, że nie będzie ona dostępna.",
    "Are you sure to delete zone: %{zone_name}": "Czy jesteś pewien, że chesz usunąć strefę: %{zone_name}",
    "Zone name and zone group cannot be empty.":
        "Nazwa strefy oraz grupa nie mogą być puste",
    'Users assigned to: %{zone_name}': 'Użytkownicy przypisani do: %{zone_name}',
    "Zone role": "Rola",
    zoneRoles: {
        "ZoneAdmin": "Administrator",
        "User": "Użytkownik",
        "Viewer": "Użytk. z ogr.",
    },
    "Assign to zone: %{zone_name}": "Przypisz do strefy: %{zone_name}",
    "Are you sure to unassign %{user} from the zone?": "Czy na pewno chcesz usunąc użytkownika %{user} z tej strefy?",
    'User/group name': 'Nazwa',
    errorCode: {
        "Forbidden (%{code})": "Brak uprawnień. (%{code})",
        "Other error. (status=%{status} code=%{code})": "Inny błąd. (status=%{status} kod=%{code})",
        "Other error. (status=%{status})": "Inny błąd. (status=%{status})",
        "213": "Grupa o tym id już istnieje. (%{code})",
        "155": 'Użytkownik/grupa o tym loginie już istnieje. (%{code})',
        "102": "Brak wymaganych uprawnień w strefie. (%{code})",
        "103": "Niepoprawna data. (%{code})",
        "104": "Brak wymaganych uprawnień w strefie. (%{code})",
        "105": "Brak wymaganych uprawnień w strefie. (%{code})",
        "106": "Miejsce przypisane do innej osoby. (%{code})",
        "109": "Nie można zarezerwować, miejsce zostało już zarezerwowane przez kogoś innego. (%{code})",
    },
    "Are you sure to update the zone?": "Czy na pewno chcesz wprowadzić zmiany?",
    "The following changes will be applied:<br>": "Następujące zmiany zostaną wprowadzone:<br>",
    "- updated zone map<br>": "- uaktualniono mapę strefy<br>",
    "- added %{smart_count} seat(s)<br>":
        "- dodano jedno miejsce<br>||||"+
        "- dodano %{smart_count} miejsca<br>||||"+
        "- dodano %{smart_count} miejsc<br>",
    "- updated data of %{smart_count} seat(s)<br>":
        "- zmienione dane jednego miejsca<br>||||"+
        "- zmienione dane %{smart_count} miejsc<br>||||"+
        "- zmienione dane %{smart_count} miejsc<br>",
    "- deleted %{smart_count} seat(s)<br>":
        "- usunięte jedno miejsce<br>||||"+
        "- usunięte %{smart_count} miejsca<br>||||"+
        "- usunięte %{smart_count} miejsc<br>",
    seatEdit: {
        "Seat name": "Nazwa",
        "X": "X",
        "Y": "Y",
    },
    "All unsaved changes will be lost.": "Wszystkie niezapisane zmiany zostaną utracone.",
    "More than %{smart_count} rows are selected. Report will be limited to that number of rows.":
        "Wybrano więcej niż jeden wiersz. Raport będzie ograniczony do tej liczby wierszów.||||"+
        "Wybrano więcej niż %{smart_count} wiersze. Raport będzie ograniczony do tej liczby wierszów.||||"+
        "Wybrano więcej niż %{smart_count} wierszów. Raport będzie ograniczony do tej liczby wierszów.",
    "Add to group": "Dodaj do grupy",
};
