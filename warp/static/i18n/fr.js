
warpGlobals.i18n = { locale: 'en' }

warpGlobals.i18n.weekdaysShort = [ 'Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam' ];

warpGlobals.i18n.datePicker = {
    firstDay: 0,    //first day of week
    i18n_object: {
        cancel:	'Annuler',
        clear: 'Effacer',
        done: 'Ok',
        previousMonth: '‹',
        nextMonth: '›',
        months: ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Decembre'],
        monthsShort: ['Jan','Fév','Mar','Avr','Mai','Juin','Juil','Aoû','Sep','Oct','Nov','Dec'],
        weekdays: ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'],
        weekdaysShort: warpGlobals.i18n.weekdaysShort,
        weekdaysAbbrev:['D','L','M','M','J','V','S'],
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
			"error":"Erreur",
        },
        "pagination":{
			"page_size":"Taille de la page",
			"page_title":"Afficher la page",
            "first":"|«",
			"first_title":"Première Page",
            "last":"»|",
			"last_title":"Dernière Page",
            "prev":"«",
			"prev_title":"Page précédente",
            "next":"»",
			"next_title":"Page suivante",
			"all":"Tous",
        },
        "headerFilters":{
            "default":"filtrer",
            "columns":{}
        }
    }
};

warpGlobals.i18n.phrases = {
    btn: {
        "Login": "Connexion",
        "Add": "Ajouter",
        "Cancel": "Annuler",
        "Delete": "Effacer",
        "Save": "Sauvegarder",
        'Yes': 'Oui',
        'No': 'Non',
        'Ok': 'Ok',
        'Set': 'Set',
        "YES, I'M SURE": "OUI, JE SUIS CERTAIN",
        "Generate password": "Générer mot de passe",
        "Book": "Réserver",
        "Update": "Mettre à jour",
        "Remove": "Enlever",
        "Assign": "Assigner",
        "Enable": "Activer",
        "Disable": "Désactiver",
        "Upload map": "Télécharger le plan",
        "Add seats": "Ajouter siège",
        "Done adding": "Ajout terminé",
        "Restore": "Restaurer",
        "Align all": "Aligner tous",
        "Finish alignment": "Terminé",
    },
    'Password': 'Mot de passe',
    'Bookings': 'Reservations',
    'Report': 'Rapport',
    'Users': 'Utilisateurs',
    'Groups': 'Groupes',
    'User name': "Nom d'utilisateur",
    'Zone': 'Zone',
    'Seat': 'Siège',
    'Time': 'Heure',
    'Login': 'Login',
    'From': 'De',
    'To': 'à',
    'Type': 'Type',
    'Group id': 'Id groupe',
    'Group name': 'Nom groupe',
    "Group name cannot be empty.": "Le nom du groupe ne peut pas être vide.",
    "Are you sure to delete group: %{group}": "Êtes-vous sûr de supprimer: %{group}",
    "Select user": "Sélectionner l'utilisateur",
    'Members of: %{group}': 'Membres de: %{group}',
    "Are you sure to remove %{user} from group %{group}?": "Êtes-vous sûr de vouloir retirer %{user} du groupe %{group}?",
    "Add to group %{group}": "Ajouter au groupe %{group}",
    'Action successfull.': 'Action réussie.',
    'Error': 'Erreur',
    'Something went wrong (status=%{status}).': "Quelque chose n'a pas fonctionné (status=%{status}).",
    'Other error.': 'Autre erreur',
    'Are you sure to delete this booking?': 'Êtes-vous sûr de vouloir supprimer cette réservation ?',
    "Are you sure?": "Êtes-vous sûr ?",
    "Account type": "Type de compte",
    "Retype password": "Confirmer le mot de passe",
    accountTypes: {
        "Admin": "Administrateur",
        "User": "Utilisateur",
        "BLOCKED": "BLOQUÉ",
    },
    "Passwords don't match": "Les mots de passe ne correspondent pas",
    "Name cannot be empty.": "Le nom ne peut être vide",
    "All fields are mandatory": "Tous les champs sont obligatoires",
    "ARE YOU SURE TO DELETE USER: %{user}?": "ÊTES-VOUS SÛR DE SUPPRIMER L'UTILISATEUR: %{user}?",
    "User has XXX bookin(s) ... ":
        "L'utilisateur a des réservations passées. Supprimer l'utilisateur supprimera les réservations passées des rapports.||||"+
        "L'utilisateur a %{smart_count} réservations passées. Supprimer l'utilisateur supprimera les réservations passées des rapports.",
    "You will delete the log of user's past bookings. It is usually a better idea to BLOCK the user.":
        "Vous allez supprimer les logs des réservations passées de cet utilisateur. C'est généralement une meilleure idée de BLOQUER l'utilisateur.",
    "Are you sure to delete user: %{user}": "Êtes vous sûr de vouloir supprimer : %{user}",
    "Select users to which the seat will be assigned:": "Sélectionnez les utilisateurs auxquels ces sièges seront assignés :",
    "The seat is available to be booked on the selected dates and time.":
        "Le siège est disponible à la réservation aux dates et horaires sélectionnés.",
    "The seat is available to be booked on the selected dates and time. However, you have other bookings at that time which will be automatically updated.":
        "Le siège est disponible à la réservation aux dates et horaires sélectionnés. Cependant, vous avez d'autres réservations à cet horaire qui seront mises à jour.",
    "The seat is booked by another person or not available.":
        "Le siège est réservé par une autre personne ou non disponible.",
    "The seat is booked by you on the selected date and time.":
        "Le siège est réservé par vous à la date et l'horaire sélectionnés.",
    "The seat is booked by you, but not exactly on the selected date or time. You can update booking, all your other reservations at that time will be automatically updated.":
        "Le siège est réservé par vous, mais pas exactement sur la plage horaire sélectionnée. Vous pouvez mettre à jour la réservation, toutes vos autres réservations sur cet horaire seront automatiquement mises à jour.",
    "The seat is booked by you, but not exactly on the selected date or time. You CANNOT update the booking as it is conflicting with another user booking.":
        "Le siège est réservé par vous, mais pas exactement sur la plage horaire sélectionnée. Vous ne pouvez pas mettre à jour votre réservation car elle est en conflit avec la réservation d'un autre utilisateur.",
    "The same meaning as the green type icon, but the seat is assigned to you, not assigned people cannot book it. Note that assignment isn't necessarily exclusive, the seat can be assigned to more than one person.":
        "La même signification que l'icone verte, mais le siège vous est assigné, les utilisateurs non-assignés ne peuvent pas le réserver. Notez que cette assignation n'est pas nécessairement exclusive. Le siège peut être assigné à plusieurs personnes.",
    "The seat is disabled, cannot be booked, and is not visible to non-admins.":
        "Le siège est désactivé, ne peut pas être réservé, et n'est pas visible aux non-admin.",
    "The seat is assigned to some people. This status is visible only to admins. Note that you won't see this icon if the seat is assigned to you.":
        "Le siège est assigné à des personnes. Ce statut n'est visible qu'aux admins. Notez que vous ne verrez pas cette icône si le siège vous est assigné.",
    "Book as": "Réserver en tant que",
    "Seat %{seat_name}": "Siège %{seat_name}",
    "Assigned to:": "Affecté à:",
    "Bookings:": "Réservations:",
    "Seat %{seat_name} to be booked:": "Le siège %{seat_name} est réservé:",
    "To be removed:": "À supprimer:",
    "Seat is successfully disabled.<br>However there are existing reservations in the the next few weeks. Existing reservations are not automatically removed, it has to be done manually.<br><br>":
        "Siège désactivé avec succès.<br>Cependant, il y a des réservations pour les prochaines semaines. Les réservations existantes ne sont pas automatiquement supprimées, ce doit être fait manuellement.<br><br>",
    "Seat is successfully assigned.<br>However there are non-assignees' existing reservations in the the next few weeks. Existing reservations are not automatically removed, it has to be done manually.<br><br>":
        "Siège assigné avec succès.<br>Cependant, il y des réservations de personnes non-assignées pour les prochaines semaines. Les réservations existantes ne sont pas automatiquement supprimées, ce doit être fait manuellement.<br><br>",
    "Warning": "Avertissement",
    "Change unsuccessfull": "Le changement n'a pas abouti",
    "Zones": "Zones",
    "Zone name": "Nom",
    "Zone group": "Groupe",
    "Num of admins": "Admins",
    "Num of users": "Utilisateurs",
    "Num of viewers": "Spectateurs",
    "Manage users": "Gérer les utilisateurs",
    'Edit zone': "Editer",
    'Edit map': "Editer plan",
    "You will delete the log of all past bookings in this zone. It is usually a better idea to unassign all users from the zone to make it inaccessible.":
        "Vous allez supprimer les logs de toutes les réservations passées de cette zone. C'est généralement une meilleure idée de supprimer tous les utilisateurs de la zone pour la rendre inaccessible.",
    "Are you sure to delete zone: %{zone_name}": "Êtes-vous sûr de supprimer la zone: %{zone_name}",
    "Zone name and zone group cannot be empty.":
        "Le nom de la zone et le groupe de zones ne peuvent pas être vides.",
    'Users assigned to: %{zone_name}': 'Les utilisateurs affectés à: %{zone_name}',
    "Zone role": "Role",
    zoneRoles: {
        "ZoneAdmin": "Admin",
        "User": "Utilisateur",
        "Viewer": "Spectateur",
    },
    "Assign to zone: %{zone_name}": "Affectation à une zone: %{zone_name}",
    "Are you sure to unassign %{user} from the zone?": "Êtes-vous sûr de désassigner %{user} de la zone ?",
    'User/group name': 'Nom',
    errorCode: {
        "Forbidden (%{code})": "Interdit (%{code})",
        "Other error. (status=%{status} code=%{code})": "Autre erreur. (status=%{status} code=%{code})",
        "Other error. (status=%{status})": "Autre erreur. (status=%{status})",
        "213": "Un groupe avec cet ID existe déjà. (%{code})",
        "155": 'Un utilisateur/groupe avec cet ID existe déjà. (%{code})',
        "102": "Vous n'avez pas les droits requis pour cette zone. (%{code})",
        "103": "Mauvaise date. (%{code})",
        "104": "Vous n'avez pas les droits requis pour cette zone. (%{code})",
        "105": "Vous n'avez pas les droits requis pour cette zone. (%{code})",
        "106": "Ce siège ne vous est pas attribué. (%{code})",
        "109": "Impossible de réserver, le siège est déjà réservé par quelqu'un d'autre. (%{code})",
    },
    "Are you sure to update the zone?": "Souhaitez vous vraiment  mettre à jour la zone?",
    "The following changes will be applied:<br>": "Les changements suivants seront appliqués:<br>",
    "- updated zone map<br>": "- plan des zones mise à jour<br>",
    "- added %{smart_count} siège(s)<br>":
        "- ajout d'un siège<br>||||"+
        "- ajout %{smart_count} sièges<br>",
    "- updated data of %{smart_count} seat(s)<br>":
        "- données actualisées d'un siège<br>||||"+
        "- données actualisées %{smart_count} sièges<br>",
    "- deleted %{smart_count} seat(s)<br>":
        "- un siège supprimé<br>||||"+
        "- %{smart_count} sièges supprimés<br>",
    seatEdit: {
        "Seat name": "Nom du siège",
        "X": "X",
        "Y": "Y",
    },
    "All unsaved changes will be lost.": "Toutes les modifications non enregistrées seront perdues.",
    "More than %{smart_count} rows are selected. Report will be limited to that number of rows.":
        "Plus d'une ligne est sélectionnée. Le rapport sera limité à ce nombre de lignes.||||"+
        "Plus de %{smart_count} lignes sont sélectionnées. Le rapport sera limité à ce nombre de lignes..",
    "Add to group": "Ajouter au groupe",
};
