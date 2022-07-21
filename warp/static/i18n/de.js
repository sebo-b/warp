
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
			"page_size":"Seiten größe",
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
        "Enable": "Enable",
        "Disable": "Disable",
        "Upload map": "Karte Hochladen",
        "Add seats": "Sitze hinzufügen",
        "Done adding": "fertig mit Bearbeitung",
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
    'Group id': 'Gruppen id',
    'Group name': 'Gruppen name',
    "Group name cannot be empty.": "Gruppenname kann nicht leer sein.",
    "Are you sure to delete group: %{group}": "Möchtest du die Gruppe %{group} wirklich löschen?",
    "Select user": "Select user",
    'Members of: %{group}': 'Mitglieder der Gruppe: %{group}',
    "Are you sure to remove %{user} from group %{group}?": "Möchtest du den Nutzenden %{user} aus der Gruppe %{group} wirklich löschen?",
    "Add to group %{group}": "Hinizufügen zur Gruppe %{group}",
    'Action successfull.': 'Glückwunsch, Aktion war erfolgreich.',
    'Error': 'Error',
    'Something went wrong (status=%{status}).': 'Irgendwas ist falsch gelaufen (status=%{status}).',
    'Other error.': 'Inny błąd',
    'Are you sure to delete this booking?': 'Möchtest du diese Buchung wirklich löschen?',
    "Are you sure?": "Bist du dir sicher?",
    "Account type": "Account type",
    "Retype password": "Passwort wiederholen",
    accountTypes: {
        "Admin": "Admin",
        "User": "User",
        "BLOCKED": "Geblockt",
    },
    "Passwords don't match": "Das passwort ist leider falsch.",
    "Name cannot be empty.": "Der Name darf nicht leer sein",
    "All fields are mandatory": "Alle Felder sind Pflichtfelder",
    "ARE YOU SURE TO DELETE USER: %{user}?": "Möchtest du diesen Nutzenden löschen: %{user}?",
    "User has XXX bookin(s) ... ":
        "User has a booking in the past. Deleting the user will delete the past booking from the report.||||"+
        "User has %{smart_count} bookings in the past. Deleting the user will delete past bookings from the report.",
    "You will delete the log of user's past bookings. It is usually a better idea to BLOCK the user.":
        "You will delete the log of user's past bookings. It is usually a better idea to BLOCK the user.",
    "Are you sure to delete user: %{user}": "Are you sure to delete user: %{user}",
    "Select users to which the seat will be assigned:": "Select users to which the seat will be assigned:",
    "The seat is available to be booked on the selected dates and time.":
        "The seat is available to be booked on the selected dates and time.",
    "The seat is available to be booked on the selected dates and time. However, you have other bookings at that time which will be automatically updated.":
        "The seat is available to be booked on the selected dates and time. However, you have other bookings at that time which will be automatically updated.",
    "The seat is booked by another person or not available.":
        "The seat is booked by another person or not available.",
    "The seat is booked by you on the selected date and time.":
        "The seat is booked by you on the selected date and time.",
    "The seat is booked by you, but not exactly on the selected date or time. You can update booking, all your other reservations at that time will be automatically updated.":
        "The seat is booked by you, but not exactly on the selected date or time. You can update booking, all your other reservations at that time will be automatically updated.",
    "The seat is booked by you, but not exactly on the selected date or time. You CANNOT update the booking as it is conflicting with another user booking.":
        "The seat is booked by you, but not exactly on the selected date or time. You CANNOT update the booking as it is conflicting with another user booking.",
    "The same meaning as the green type icon, but the seat is assigned to you, not assigned people cannot book it. Note that assignment isn't necessarily exclusive, the seat can be assigned to more than one person.":
        "The same meaning as the green type icon, but the seat is assigned to you, not assigned people cannot book it. Note that assignment isn't necessarily exclusive, the seat can be assigned to more than one person.",
    "The same meaning as the green type icon, but the seat is assigned to you, not assigned people cannot book it. Note that assignment isn't necessarily exclusive, the seat can be assigned to more than one person.":
        "The same meaning as the green type icon, but the seat is assigned to you, not assigned people cannot book it. Note that assignment isn't necessarily exclusive, the seat can be assigned to more than one person.",
    "The seat is disabled, cannot be booked, and is not visible to non-admins.":
        "The seat is disabled, cannot be booked, and is not visible to non-admins.",
    "The seat is assigned to some people. This status is visible only to admins. Note that you won't see this icon if the seat is assigned to you.":
        "The seat is assigned to some people. This status is visible only to admins. Note that you won't see this icon if the seat is assigned to you.",
    "Book as": "Buchen als",
    "Seat %{seat_name}": "Sitz %{seat_name}",
    "Assigned to:": "zugeordnet zu:",
    "Bookings:": "Buchungen:",
    "Seat %{seat_name} to be booked:": "Seat %{seat_name} to be booked:",
    "To be removed:": "To be removed:",
    "Seat is successfully disabled.<br>However there are existing reservations in the the next few weeks. Existing reservations are not automatically removed, it has to be done manually.<br><br>":
        "Seat is successfully disabled.<br>However there are existing reservations in the the next few weeks. Existing reservations are not automatically removed, it has to be done manually.<br><br>",
    "Seat is successfully assigned.<br>However there are non-assignees' existing reservations in the the next few weeks. Existing reservations are not automatically removed, it has to be done manually.<br><br>":
        "Seat is successfully assigned.<br>However there are non-assignees' existing reservations in the the next few weeks. Existing reservations are not automatically removed, it has to be done manually.<br><br>",
    "Warning": "Warning",
    "Change unsuccessfull": "Änderung nicht erfolgreich",
    "Zones": "Zones",
    "Zone name": "Name",
    "Zone group": "Group",
    "Num of admins": "Admins",
    "Num of users": "Users",
    "Num of viewers": "Viewers",
    "Manage users": "Nutzende verwalten",
    'Edit zone': "Edit",
    'Edit map': "Karte editieren",
    "You will delete the log of all past bookings in this zone. It is usually a better idea to unassign all users from the zone to make it inaccessible.":
        "You will delete the log of all past bookings in this zone. It is usually a better idea to unassign all users from the zone to make it inaccessible.",
    "Are you sure to delete zone: %{zone_name}": "Are you sure to delete zone: %{zone_name}",
    "Zone name and zone group cannot be empty.":
        "Zone name and zone group cannot be empty.",
    'Users assigned to: %{zone_name}': 'Users assigned to: %{zone_name}',
    "Zone role": "Role",
    zoneRoles: {
        "ZoneAdmin": "Admin",
        "User": "User",
        "Viewer": "Viewer",
    },
    "Assign to zone: %{zone_name}": "Assign to zone: %{zone_name}",
    "Are you sure to unassign %{user} from the zone?": "Are you sure to unassign %{user} from the zone?",
    'User/group name': 'Name',
    errorCode: {
        "Forbidden (%{code})": "Forbidden (%{code})",
        "Other error. (status=%{status} code=%{code})": "Other error. (status=%{status} code=%{code})",
        "Other error. (status=%{status})": "Other error. (status=%{status})",
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
    "- updated zone map<br>": "- updated zone map<br>",
    "- added %{smart_count} seat(s)<br>":
        "- added one seat<br>||||"+
        "- added %{smart_count} seats<br>",
    "- updated data of %{smart_count} seat(s)<br>":
        "- updated data of a seat<br>||||"+
        "- updated data of %{smart_count} seats<br>",
    "- deleted %{smart_count} seat(s)<br>":
        "- deleted a seat<br>||||"+
        "- deleted %{smart_count} seats<br>",
    seatEdit: {
        "Seat name": "Seat name",
        "X": "X",
        "Y": "Y",
    },
    "All unsaved changes will be lost.": "Alle ungespeicherten Inforamtionen gehen verloren.",
    "More than %{smart_count} rows are selected. Report will be limited to that number of rows.":
        "More than one row is selected. Report will be limited to that number of rows.||||"+
        "More than %{smart_count} rows are selected. Report will be limited to that number of rows.",
    "Add to group": "Add to group",
};
