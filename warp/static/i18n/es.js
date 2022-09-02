
warpGlobals.i18n = { locale: 'es' }

warpGlobals.i18n.weekdaysShort = [ 'Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab' ];

warpGlobals.i18n.datePicker = {
    firstDay: 0,    //first day of week
    i18n_object: {
        cancel:	'Cancelar',
        clear: 'Limpiar',
        done: 'Ok',
        previousMonth: '',
        nextMonth: '',
        months: ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'],
        monthsShort: ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'],
        weekdays: ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'],
        weekdaysShort: warpGlobals.i18n.weekdaysShort,
        weekdaysAbbrev:['D','L','M','X','J','V','S'],
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
			"page_size":"Tamaño de Página",
			"page_title":"Mostrar Página",
            "first":"|«",
			"first_title":"Primera Página",
            "last":"»|",
			"last_title":"Última Página",
            "prev":"«",
			"prev_title":"Página Anterior",
            "next":"»",
			"next_title":"Próxima Página",
			"all":"Todos",
        },
        "headerFilters":{
            "default":"Filtro",
            "columns":{}
        }
    }
};

warpGlobals.i18n.phrases = {
    btn: {
        "Login": "Iniciar sesión",
        "Add": "Agregar",
        "Cancel": "Cancelar",
        "Delete": "Borrar",
        "Save": "Guardar",
        'Yes': 'Sí',
        'No': 'No',
        'Ok': 'Ok',
        'Set': 'Establecer',
        "YES, I'M SURE": "SÍ, ESTOY SEGURO",
        "Generate password": "Generar contraseña",
        "Book": "Reservar",
        "Update": "Actualizar",
        "Remove": "Remover",
        "Assign": "Asignar",
        "Enable": "Habilitar",
        "Disable": "Deshabilitar",
        "Upload map": "Subir mapa",
        "Add seats": "Agregar Asientos",
        "Done adding": "Terminar de Agregar",
        "Restore": "Restaurar",
        "Align all": "Alinear todos",
        "Finish alignment": "Terminar",
    },
    'Password': 'Contraseña',
    'Bookings': 'Reservas',
    'Report': 'Reporte',
    'Users': 'Usuarios',
    'Groups': 'Grupos',
    'User name': 'Nombre del Usuario',
    'Zone': 'Zona',
    'Seat': 'Asiento',
    'Time': 'Fecha y Hora',
    'Login': 'Login',
    'From': 'Desde',
    'To': 'Hasta',
    'Type': 'Tipo',
    'Group id': 'Id de Grupo',
    'Group name': 'Nombre del Grupo',
    "Group name cannot be empty.": "El Nombre del Grupo no puede estar vacío.",
    "Are you sure to delete group: %{group}": "¿Está seguro de borrar el grupo: %{group}?",
    "Select user": "Seleccione usuario",
    'Members of: %{group}': 'Miembros de: %{group}',
    "Are you sure to remove %{user} from group %{group}?": "¿Está seguro de quitar el usuario %{user} del grupo %{group}?",
    "Add to group %{group}": "Agregar al grupo %{group}",
    'Action successfull.': 'Realizado correctamente',
    'Error': 'Error',
    'Something went wrong (status=%{status}).': 'Algo ha ocurrido (estado=%{status}).',
    'Other error.': 'Inny błąd',
    'Are you sure to delete this booking?': '¿Está seguro de cancelar esta reserva?',
    "Are you sure?": "¿Está seguro?",
    "Account type": "Tipo de Cuenta",
    "Retype password": "Reingrese Contraseña",
    accountTypes: {
        "Admin": "Administrador",
        "User": "Usuario",
        "BLOCKED": "BLOQUEADO",
    },
    "Passwords don't match": "Las contraseñas no coinciden",
    "Name cannot be empty.": "El nombre no puede estar vacío.",
    "All fields are mandatory": "Todos los campos son obligatorios!",
    "ARE YOU SURE TO DELETE USER: %{user}?": "¿ESTÁ SEGURO DE BORRAR EL USUARIO: %{user}?",
    "User has XXX bookin(s) ... ":
        "El usuario tiene reservas pasadas y borrarlo también eliminará el histórico del mismo.||||"+
        "El usuario tiene %{smart_count} reservas pasadas y borrarlo también eliminará el histórico del mismo.",
    "You will delete the log of user's past bookings. It is usually a better idea to BLOCK the user.":
        "Esta acción también borrará el registro histórico de reservas del usuario, para evitar esto es recomendable bloquear su cuenta sin borrarla.",
    "Are you sure to delete user: %{user}": "¿Está seguro de borrar el usuario: %{user}?",
    "Select users to which the seat will be assigned:": "Seleccione los usuarios a los que le asignará el asiento:",
    "The seat is available to be booked on the selected dates and time.":
        "Este asiento está disponible para ser reservado en las fechas y horas seleccionadas.",
    "The seat is available to be booked on the selected dates and time. However, you have other bookings at that time which will be automatically updated.":
        "Este asiento está disponible para ser reservado en las fechas y horas seleccionadas sin embargo, usted tiene otras reservas en el mismo horario que resultarán automáticamente actualizadas.",
    "The seat is booked by another person or not available.":
        "Este asiento fué reservado por otra persona o no está disponible.",
    "The seat is booked by you on the selected date and time.":
        "Este asiento ya que se encuentra reservado para usted en la fecha y hora seleccionados.",
    "The seat is booked by you, but not exactly on the selected date or time. You can update booking, all your other reservations at that time will be automatically updated.":
        "Este asiento está reservado por usted pero no exactamente en el horario seleccionado. Usted puede actualizar su reserva, y todas sus otras reservas a esa hora serán automáticamente actualizadas.",
    "The seat is booked by you, but not exactly on the selected date or time. You CANNOT update the booking as it is conflicting with another user booking.":
        "Este asiento está reservado por usted pero no exactamente en el horario seleccionado. Usted NO puede actualizar su reserva ya que entra en conflicto con la reserva de otra persona.",
    "The same meaning as the green type icon, but the seat is assigned to you, not assigned people cannot book it. Note that assignment isn't necessarily exclusive, the seat can be assigned to more than one person.":
        "El mismo significado que el del ícono verde, pero el asiento está reservado para usted. Personas sin reservas no podrán reservarlo. La reserva no es necesariamente excluyente ya que, el asiento puede ser asignado a mas de una persona.",
    "The seat is disabled, cannot be booked, and is not visible to non-admins.":
        "El asiento está deshabilitado, no puede ser reservado, y usuarios sin permisos Administrativos no podrán verlo.",
    "The seat is assigned to some people. This status is visible only to admins. Note that you won't see this icon if the seat is assigned to you.":
        "Este asiento está reservado para algunas personas. Este estado solo es visible para usuarios con permisos Administrativos. NOTA: Usted no verá este ícono si el asiento está asignado a usted.",
    "Book as": "Reservar como",
    "Seat %{seat_name}": "Asiento %{seat_name}",
    "Assigned to:": "Asignado a:",
    "Bookings:": "Reservas:",
    "Seat %{seat_name} to be booked:": "Asiento %{seat_name} para ser reservado:",
    "To be removed:": "Reserva que remueve:",
    "Seat is successfully disabled.<br>However there are existing reservations in the the next few weeks. Existing reservations are not automatically removed, it has to be done manually.<br><br>":
        "El asiento fué deshabilitado correctamente.<br>Sin embargo, hay reservas existentes para las próximas pocas semanas. Las reservas existentes no serán removidas automáticamentes, se deberá realizar manualmente!<br><br>",
    "Seat is successfully assigned.<br>However there are non-assignees' existing reservations in the the next few weeks. Existing reservations are not automatically removed, it has to be done manually.<br><br>":
        "El asiento fué correctamente asignado.<br>Sin embargo, hay reservas existentes de no asignados en las próximas semanas. Las reservas existentes no se eliminan automáticamente, tiene que hacerse manualmente.<br><br>",
    "Warning": "Advertencia",
    "Change unsuccessfull": "Error al aplicar cambios",
    "Zones": "Zonas",
    "Zone name": "Nombre",
    "Zone group": "Grupo",
    "Num of admins": "Administradores",
    "Num of users": "Usuarios",
    "Num of viewers": "Expectadores",
    "Manage users": "Administrar usuarios",
    'Edit zone': "Editar",
    'Edit map': "Editar mapa",
    "You will delete the log of all past bookings in this zone. It is usually a better idea to unassign all users from the zone to make it inaccessible.":
        "Borrará el registro de todas las reservas pasadas en esta zona. Es generalmente recomendable des-asignar todos los usuarios de la zona para hacerla inaccessible.",
    "Are you sure to delete zone: %{zone_name}": "¿Está seguro de borrar la zona: %{zone_name}?",
    "Zone name and zone group cannot be empty.":
        "El nombre de la zona no puede estar vacío.",
    'Users assigned to: %{zone_name}': 'Usuarios asignados a: %{zone_name}',
    "Zone role": "Rol",
    zoneRoles: {
        "ZoneAdmin": "Administrador",
        "User": "Usuario",
        "Viewer": "Expectador",
    },
    "Assign to zone: %{zone_name}": "Asignar a zonaa: %{zone_name}",
    "Are you sure to unassign %{user} from the zone?": "¿Está seguro de des-asignar el usuario %{user} de la zona?",
    'User/group name': 'Nombre',
    errorCode: {
        "Forbidden (%{code})": "Prohibido (%{code})",
        "Other error. (status=%{status} code=%{code})": "Otro error. (status=%{status} code=%{code})",
        "Other error. (status=%{status})": "Otro error. (status=%{status})",
        "213": "Ya existe un grupo con este mismo Id. (%{code})",
        "155": 'Ya existe otro Usuario o Grupo con este username. (%{code})',
        "102": "Usted no posee los permisos requeridos para esta zona. (%{code})",
        "103": "Fecha inválida. (%{code})",
        "104": "Usted no posee los permisos requeridos para esta zona. (%{code})",
        "105": "Usted no posee los permisos requeridos para esta zona. (%{code})",
        "106": "El asiento no está asignado a usted. (%{code})",
        "109": "No se puede reservar, el asiento ya fué reservado por otra persona. (%{code})",
    },
    "Are you sure to update the zone?": "¿Está seguro de actualizar la zona?",
    "The following changes will be applied:<br>": "Los siguientes cambios serán aplicados:<br>",
    "- updated zone map<br>": "- Mapa de zona actualizado<br>",
    "- added %{smart_count} seat(s)<br>":
        "- Un asiento agregado<br>||||"+
        "- %{smart_count} asientos agregados<br>",
    "- updated data of %{smart_count} seat(s)<br>":
        "- Datos actualizados de un asiento<br>||||"+
        "- Datos actualizados para %{smart_count} asientos<br>",
    "- deleted %{smart_count} seat(s)<br>":
        "- Un asiento fué borrado<br>||||"+
        "- %{smart_count} asientos fueron borrados<br>",
    seatEdit: {
        "Seat name": "Nombre del asiento",
        "X": "X",
        "Y": "Y",
    },
    "All unsaved changes will be lost.": "Todos los cambios sin guardar se perderán.",
    "More than %{smart_count} rows are selected. Report will be limited to that number of rows.":
        "Se seleccionaron más de una fila. El informe se limitará a ese número de filas.||||"+
        "Se seleccionaron {smart_count} filas. El informe se limitará a ese número de filas.",
    "Add to group": "Agregar al grupo",
};
