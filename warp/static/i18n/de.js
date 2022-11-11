
warpGlobals.i18n = { locale: 'de' }

warpGlobals.i18n.weekdaysShort = [ 'So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa' ];

warpGlobals.i18n.datePicker = {
    firstDay: 0,    //first day of week
    i18n_object: {
        cancel:	'Abbrechen',
        clear: 'Bereinigen',
        done: 'Ok',
        previousMonth: '‹',
        nextMonth: '›',
        months: ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'July', 'August', 'September', 'Oktober', 'November', 'Dezember'],
        monthsShort: ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'],
        weekdays: ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'],
        weekdaysShort: warpGlobals.i18n.weekdaysShort,
        weekdaysAbbrev:['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa' ],
    },
};

warpGlobals.i18n.tabulatorLangs = {
    "default": {    //keep default, so setting locale is not needed
        "groups":{
			"item":"item",
			"items":"items",
        },
        "columns":{
        },
        "data":{
			"loading":"",   //just spinner is shown
			"error":"Error",
        },
        "pagination":{
			"page_size":"Seitengröße",
			"page_title":"Zeige Seite ",
            "first":"|«",
			"first_title":"Erste Seite",
            "last":"»|",
			"last_title":"Letzte Seite",
            "prev":"«",
			"prev_title":"Vorherige Seite",
            "next":"»",
			"next_title":"Nächste Seite",
			"all":"Alle",
        },
        "headerFilters":{
            "default":"filter",
            "columns":{}
        }
    }
};

warpGlobals.i18n.phrases = {
    btn: {
        "Login": "Login",
        "Add": "Hinzufügen",
        "Cancel": "Abbrechen",
        "Delete": "Löschen",
        "Save": "Speichern",
        'Yes': 'Ja',
        'No': 'Nein',
        'Ok': 'Ok',
        'Set': 'Set',
        "YES, I'M SURE": "JA, ICH BIN SICHER",
        "Generate password": "Passwort erstellen",
        "Book": "Buchen",
        "Update": "Update",
        "Remove": "Entfernen",
        "Assign": "Zuweisen",
        "Enable": "Freigeben",
        "Disable": "Sperren",
        "Upload map": "Karte hochladen",
        "Add seats": "Sitze hinzufügen",
        "Done adding": "Fertig mit der Bearbeitung",
        "Restore": "Wiederherstellen",
        "Align all": "Alle zuweisen",
        "Finish alignment": "Fertig",
    },
    'Password': 'Passwort',
    'Bookings': 'Buchungen',
    'Report': 'Report',
    'Users': 'Users',
    'Groups': 'Gruppe',
    'User name': 'User name',
    'Zone': 'Zone',
    'Seat': 'Sitz',
    'Time': 'Zeit',
    'Login': 'Login',
    'From': 'Von',
    'To': 'Bis',
    'Type': 'Typ',
    'Group id': 'Gruppen ID',
    'Group name': 'Gruppenname',
    "Group name cannot be empty.": "Gruppenname kann nicht leer sein.",
    "Are you sure to delete group: %{group}": "Möchtest du die Gruppe %{group} wirklich löschen?",
    "Select user": "Wähle Benutzende",
    'Members of: %{group}': 'Mitglieder der Gruppe: %{group}',
    "Are you sure to remove %{user} from group %{group}?": "Möchtest du diesen Nutzenden %{user} aus der Gruppe %{group} wirklich löschen?",
    "Add to group %{group}": "Hinzufügen zur Gruppe %{group}",
    'Action successfull.': 'Glückwunsch, Aktion war erfolgreich.',
    'Error': 'Error',
    'Something went wrong (status=%{status}).': 'Irgendwas ist falsch gelaufen (status=%{status}).',
    'Other error.': 'Anderer Fehler',
    'Are you sure to delete this booking?': 'Möchtest du diese Buchung wirklich löschen?',
    "Are you sure?": "Bist du dir sicher?",
    "Account type": "Account Typ",
    "Retype password": "Passwort wiederholen",
    accountTypes: {
        "Admin": "Admin",
        "User": "Mitarbeitende:r",
        "BLOCKED": "GEBLOCKT",
    },
    "Passwords don't match": "Das Passwort ist leider falsch.",
    "Name cannot be empty.": "Der Name darf nicht leer sein",
    "All fields are mandatory": "Alle Felder sind Pflichtfelder",
    "ARE YOU SURE TO DELETE USER: %{user}?": "Möchtest du diesen Nutzenden löschen: %{user}?",
    "User has XXX bookin(s) ... ":
        "Der Benutzer hat eine Buchung in der Vergangenheit. Wenn Sie den Benutzer löschen, wird die vergangene Buchung aus dem Bericht gelöscht.||||"+
        "Der Benutzer hat %{smart_count} Buchungen in der Vergangenheit. Wenn Sie den Benutzer löschen, werden die vergangenen Buchungen aus dem Bericht gelöscht.",
    "Sie löschen das Protokoll der vergangenen Buchungen des Benutzers. In der Regel ist es besser, den Benutzer zu BLOCKIEREN.":
        "Sie löschen das Protokoll der vergangenen Buchungen des Benutzers. In der Regel ist es besser, den Benutzer zu BLOCKIEREN.",
    "Are you sure to delete user: %{user}": "Sind Sie sicher, dass Sie Benutzer: %{user} löschen wollen?",
    "Select users to which the seat will be assigned:": "Wählen Sie die Benutzer aus, denen der Platz zugewiesen werden soll:",
    "The seat is available to be booked on the selected dates and time.":
        "Der Sitzplatz kann zu den ausgewählten Daten und Uhrzeiten gebucht werden.",
    "The seat is available to be booked on the selected dates and time. However, you have other bookings at that time which will be automatically updated.":
        "Der Sitzplatz kann zu den ausgewählten Daten und Uhrzeiten gebucht werden. Sie haben jedoch andere Buchungen zu diesem Zeitpunkt, die automatisch aktualisiert werden.",
    "The seat is booked by another person or not available.":
        "Der Platz ist von einer anderen Person gebucht oder nicht verfügbar.",
    "The seat is booked by you on the selected date and time.":
        "Der Sitzplatz wird von Ihnen für das ausgewählte Datum und die ausgewählte Uhrzeit gebucht.",
    "The seat is booked by you, but not exactly on the selected date or time. You can update booking, all your other reservations at that time will be automatically updated.":
        "Der Sitzplatz ist von Ihnen gebucht, aber nicht genau zum gewählten Datum oder zur gewählten Uhrzeit. Sie können die Buchung aktualisieren, alle Ihre anderen Reservierungen zu dieser Zeit werden automatisch aktualisiert.",
    "The seat is booked by you, but not exactly on the selected date or time. You CANNOT update the booking as it is conflicting with another user booking.":
        "Der Sitzplatz ist von Ihnen gebucht, aber nicht genau zum gewählten Datum oder zur gewählten Uhrzeit. Sie können die Buchung NICHT aktualisieren, da sie mit der Buchung eines anderen Nutzers kollidiert.",
    "The same meaning as the green type icon, but the seat is assigned to you, not assigned people cannot book it. Note that assignment isn't necessarily exclusive, the seat can be assigned to more than one person.":
        "Die gleiche Bedeutung wie das grüne Symbol, aber der Platz ist Ihnen zugewiesen, nicht zugewiesene Personen können ihn nicht buchen. Beachten Sie, dass die Zuweisung nicht unbedingt exklusiv ist, der Sitzplatz kann auch mehreren Personen zugewiesen werden.",
    "The same meaning as the green type icon, but the seat is assigned to you, not assigned people cannot book it. Note that assignment isn't necessarily exclusive, the seat can be assigned to more than one person.":
        "Die gleiche Bedeutung wie das grüne Symbol, aber der Platz ist Ihnen zugewiesen, nicht zugewiesene Personen können ihn nicht buchen. Beachten Sie, dass die Zuweisung nicht unbedingt exklusiv ist, der Sitzplatz kann auch mehreren Personen zugewiesen werden.",
    "The seat is disabled, cannot be booked, and is not visible to non-admins.":
        "Der Platz ist deaktiviert, kann nicht gebucht werden und ist für Nicht-Administratoren nicht sichtbar.",
    "The seat is assigned to some people. This status is visible only to admins. Note that you won't see this icon if the seat is assigned to you.":
        "Der Platz ist bestimmten Personen zugewiesen. Dieser Status ist nur für Administratoren sichtbar. Beachten Sie, dass Sie dieses Symbol nicht sehen werden, wenn der Platz Ihnen zugewiesen ist.",
    "Book as": "Buchen als",
    "Seat %{seat_name}": "Sitz %{seat_name}",
    "Assigned to:": "zugeordnet zu:",
    "Bookings:": "Buchungen:",
    "Seat %{seat_name} to be booked:": "Sitzplatz %{seat_name} soll gebucht werden:",
    "To be removed:": "Soll entfernt werden:",
    "Seat is successfully disabled.<br>However there are existing reservations in the the next few weeks. Existing reservations are not automatically removed, it has to be done manually.<br><br>":
        "Sitzplatz ist erfolgreich deaktiviert.<br>Es gibt jedoch bestehende Reservierungen für die nächsten Wochen. Bestehende Reservierungen werden nicht automatisch entfernt, dies muss manuell geschehen.<br><br>",
    "Seat is successfully assigned.<br>However there are non-assignees' existing reservations in the the next few weeks. Existing reservations are not automatically removed, it has to be done manually.<br><br>":
        "Der Sitzplatz wurde erfolgreich zugewiesen.<br> Allerdings gibt es in den nächsten Wochen bestehende Reservierungen von Nicht-Empfängern. Bestehende Reservierungen werden nicht automatisch entfernt, sondern müssen manuell vorgenommen werden.<br><br>",
    "Warning": "Warnung",
    "Change unsuccessfull": "Änderung nicht erfolgreich",
    "Zones": "Zonen",
    "Zone name": "Name",
    "Zone group": "Zonengruppe",
    "Num of admins": "Anzahl Admins",
    "Num of users": "Anzahl Nutzende",
    "Num of viewers": "Betrachtende",
    "Manage users": "Nutzende verwalten",
    'Edit zone': "Editieren",
    'Edit map': "Karte editieren",
    "You will delete the log of all past bookings in this zone. It is usually a better idea to unassign all users from the zone to make it inaccessible.":
        "Sie löschen das Protokoll aller vergangenen Buchungen in dieser Zone. Normalerweise ist es besser, alle Benutzer aus der Zone zu entfernen, um sie unzugänglich zu machen.",
    "Are you sure to delete zone: %{zone_name}": "Sind Sie sicher, dass Sie die Zone %{zone_name} löschen wollen?",
    "Zone name and zone group cannot be empty.":
        "Zonenname und Zonengruppe dürfen nicht leer sein.",
    'Users assigned to: %{zone_name}': 'Nutzende zugewiesen: %{zone_name}',
    "Zone role": "Rolle",
    zoneRoles: {
        "ZoneAdmin": "Admin",
        "User": "Mitarbeitende",
        "Viewer": "Betrachter",
    },
    "Assign to zone: %{zone_name}": "Der Zone zuordnen: %{zone_name}",
    "Are you sure to unassign %{user} from the zone?": "Sind Sie sicher, dass Sie die Zuweisung von %{user} aus der Zone aufheben können?",
    'User/group name': 'Name',
    errorCode: {
        "Forbidden (%{code})": "Forbidden (%{code})",
        "Other error. (status=%{status} code=%{code})": "Anderer Error. (status=%{status} code=%{code})",
        "Other error. (status=%{status})": "Anderer Error. (status=%{status})",
        "213": "Eine Gruppe mit dieser id existiert bereits. (%{code})",
        "155": 'User/group mit diesem login existiert bereits. (%{code})',
        "102": "Du hast nicht die verlangten Berechtigungen für diese Zone. (%{code})",
        "103": "Falsches Datum. (%{code})",
        "104": "Du hast nicht die verlangten Berechtigungen für diese Zone. (%{code})",
        "105": "Du hast nicht die verlangten Berechtigungen für diese Zone. (%{code})",
        "106": "Dieser Sitz ist dir nicht zugewiesen . (%{code})",
        "109": "Dieser Sitz wurde schon von jemand anderem gebucht. (%{code})",
    },
    "Are you sure to update the zone?": "Möchtest du die Zone aktualisieren??",
    "The following changes will be applied:<br>": "Die folgenden Änderungen werden gemacht:<br>",
    "- updated zone map<br>": "- aktualisierte Zonenkarte<br>",
    "- added %{smart_count} seat(s)<br>":
        "- Ein Platz hinzugefügt<br>||||"+
        "- %{smart_count} Plätzde hinzugefügt<br>",
    "- updated data of %{smart_count} seat(s)<br>":
        "- Daten des Platzes aktualisiert<br>||||"+
        "- Daten von %{smart_count} Plätzen aktualisiert<br>",
    "- deleted %{smart_count} seat(s)<br>":
        "- Ein Sitz gelöscht<br>||||"+
        "- %{smart_count} Sitze gelöscht<br>",
    seatEdit: {
        "Seat name": "Sitzname",
        "X": "X",
        "Y": "Y",
    },
    "All unsaved changes will be lost.": "Alle ungespeicherten Inforamtionen gehen verloren.",
    "More than %{smart_count} rows are selected. Report will be limited to that number of rows.":
        "Es wurde mehr als eine Zeile ausgewählt. Der Bericht wird auf diese Anzahl von Zeilen beschränkt.||||"+
        "Es sind mehr als %{smart_count} Zeilen ausgewählt. Der Bericht wird auf diese Anzahl von Zeilen beschränkt.",
    "Add to group": "Zur Gruppe hinzufügen",
};
