"use strict";

import html from './html/planModify.html';
import Utils from './modules/utils.js';
import WarpModal from './modules/modal.js';
import { SeatFactory, spriteSize} from './modules/planModify_seat.js';
import { MarqueeController } from './modules/zoneModify_marquee.js';
import { TransformController } from './modules/zoneModify_transform.js';
import { M } from '../app/materialize.js';
import { initFormSelect } from '../lib/formSelect.js';
import { confirmDelete } from '../lib/confirmDelete.js';
import { setLeaveGuard, clearLeaveGuard } from '../app/router.js';

export { html };

export async function mount(ctx) {
    const root = ctx.root;
    // Route params are always strings (router.js); the backend's JSON schema
    // requires pid as an integer (the old Jinja-rendered `window.warpGlobals.pid
    // = {{ pid }}` emitted a bare numeric literal, not a string).
    const pid = parseInt(ctx.params.pid, 10);
    const returnURL = ctx.query.return || '/plans';

    const plansGetSeatsURL = window.warpGlobals.URLs['plansGetSeats'].replace('__PID__', pid);
    const planImageURL = window.warpGlobals.URLs['planImage'].replace('__PID__', pid);

    // darkFilter is per-plan (dropped from view.py's planModify route in WP1);
    // getContext is the SPA replacement — same endpoint the plan view uses,
    // here only its darkFilter field is needed.
    const contextResp = await Utils.xhr.get(
        window.warpGlobals.URLs['planGetContext'].replace('__PID__', pid),
        { toastOnSuccess: false, errorOnFailure: false });
    const darkFilter = contextResp.response.darkFilter;

    let themeObserver = null;

    let chooseImgBtn = root.querySelector('#chooseImgBtn');
    let mapUploadInput = root.querySelector('#mapUploadInput');
    let saveBtn = root.querySelector('#saveBtn');

    function isDirty() {
        return mapUploadInput.files.length > 0 || seatFactory.isChanged() || isFilterDirty();
    }

    function setDirty() {
        if (isDirty()) saveBtn.classList.remove('disabled');
        else saveBtn.classList.add('disabled');
    }

    let zoneMapImg = root.querySelector('#zone_map');
    zoneMapImg.src = planImageURL;
    let zoneMapContainer = root.querySelector('#zone_map_container');

    let planModifyTabs = root.querySelector('#plan_modify_tabs');
    let activeTab = 'transform';

    let seatEditPanel = root.querySelector("#seat_edit_panel");
    let seatNameEl = root.querySelector("#seat_name");
    let seatXEl = root.querySelector("#seat_x");
    let seatYEl = root.querySelector("#seat_y");
    let seatZoneEl = root.querySelector("#seat_zone");
    let seatDeleteBtn = root.querySelector('#seat_delete_btn');

    // Available zones for the seat zone selector
    let allZones = [];

    // Zone dropdown for add-seats mode (added in template)
    let addSeatZoneSelector = root.querySelector('#add_seat_zone_selector');
    let addSeatZoneEl = root.querySelector('#add_seat_zone');
    let addSeatZoneError = root.querySelector('#add_seat_zone_error');

    // Most-frequent zone on this plan (pre-selected in add-seats mode)
    let mostFrequentZid = null;
    let addModeZonesInitialized = false;

    function populateAddSeatZoneSelect(selectedZid) {
        if (!addSeatZoneEl) return;

        addSeatZoneEl.innerHTML = '';
        for (let z of allZones) {
            let opt = document.createElement('option');
            opt.value = z.id;
            opt.textContent = z.name;
            if (selectedZid !== null && selectedZid !== undefined && z.id == selectedZid)
                opt.selected = true;
            addSeatZoneEl.appendChild(opt);
        }

        // Initialize as proper Materialize select (not .browser-default)
        initFormSelect(addSeatZoneEl, {
            dropdownOptions: {
                container: addSeatZoneEl.closest('.zone_modify_sidepanel') || root
            }
        });
    }

    function populateZoneSelect(selectedZid) {
        seatZoneEl.innerHTML = '';
        for (let z of allZones) {
            let opt = document.createElement('option');
            opt.value = z.id;
            opt.textContent = z.name;
            if (selectedZid !== null && selectedZid !== undefined && z.id == selectedZid)
                opt.selected = true;
            seatZoneEl.appendChild(opt);
        }
        initFormSelect(seatZoneEl, {
            dropdownOptions: {
                container: seatZoneEl.closest('.zone_modify_sidepanel') || root
            }
        });
    }

    // Load all zones (for selectors) + zones already present on this plan + current seats,
    // so we can compute the most-frequent zone (by seat count) for the "first time entering add mode" preselection.
    Promise.all([
        Utils.xhr.get(window.warpGlobals.URLs['plansAllZones'], {toastOnSuccess: false}),
        Utils.xhr.get(window.warpGlobals.URLs['plansZonesForPlan'] + '?pid=' + pid, {toastOnSuccess: false}),
        Utils.xhr.get(plansGetSeatsURL, {toastOnSuccess: false})
    ])
    .then(function(results) {
        allZones = results[0].response || [];
        let planZones = results[1].response || [];
        let seatsData = results[2].response || {};

        // Populate the per-seat zone selector (used for editing existing / newly-placed seats in Edit mode).
        populateZoneSelect(null);

        // Feed zone names to the seat factory for on-map labels (multi-zone detection + zone name display).
        let zonesNameMap = {};
        for (let z of allZones) zonesNameMap[z.id] = z.name;
        seatFactory.setZonesNames(zonesNameMap);

        // Compute most frequent zone on *this plan* (used only when user first flips to "Add seats").
        let zoneCounts = {};
        for (let sid in seatsData) {
            let zid = seatsData[sid].zid;
            if (zid !== undefined) zoneCounts[zid] = (zoneCounts[zid] || 0) + 1;
        }
        let maxCount = 0;
        mostFrequentZid = null;
        for (let zid in zoneCounts) {
            if (zoneCounts[zid] > maxCount) {
                maxCount = zoneCounts[zid];
                mostFrequentZid = parseInt(zid);
            }
        }
        // If the plan has no seats yet, but already references one or more zones, fall back to the first one.
        if (mostFrequentZid === null && planZones.length > 0) {
            mostFrequentZid = planZones[0].id;
        }

        // If the active tab was switched to "Add mode" before zone data arrived,
        // reconcile the dropdown/error banner so the user never sees a stale state.
        if (activeTab === 'add' && addSeatZoneSelector && addSeatZoneError && addSeatZoneEl) {
            if (allZones.length === 0) {
                addSeatZoneSelector.style.display = 'none';
                addSeatZoneError.style.display = 'block';
            } else {
                addSeatZoneSelector.style.display = 'block';
                addSeatZoneError.style.display = 'none';
                if (!addModeZonesInitialized) {
                    let pre = (mostFrequentZid !== null) ? mostFrequentZid : allZones[0].id;
                    populateAddSeatZoneSelect(pre);
                    addModeZonesInitialized = true;
                }
            }
        }

        // Do *not* pre-populate the add-seat zone dropdown during the initial page load.
        // Per spec: the most-frequent (or any) pre-selection must only happen
        // "the moment user switches to add for the first time".
    });

    let seatFactory = new SeatFactory(plansGetSeatsURL, zoneMapContainer, zoneMapImg);
    let marquee = new MarqueeController(zoneMapContainer, spriteSize);
    let transform = null;

    let showMarquee = () => {
        if (activeTab !== 'transform') return;
        let transformSeats = seatFactory.getTransformSeats();
        if (transformSeats.length > 0)
            marquee.show(transformSeats);
    };

    let resetCursor = () => {
        zoneMapContainer.style.cursor = '';
    };

    function setMode(tabId) {
        activeTab = tabId;

        if (activeTab === 'transform') {
            seatFactory.setReferenceMode(false);
            if (addSeatZoneSelector) addSeatZoneSelector.style.display = 'none';
            if (addSeatZoneError) addSeatZoneError.style.display = 'none';
            showMarquee();
        }
        else if (activeTab === 'add') {
            seatFactory.setReferenceMode(false);
            marquee.hide();
            seatFactory.clearSelection();
            seatEditPanel.style.visibility = "hidden";

            if (addSeatZoneSelector && addSeatZoneError && addSeatZoneEl) {
                if (allZones.length === 0) {
                    addSeatZoneSelector.style.display = 'none';
                    addSeatZoneError.style.display = 'block';
                } else {
                    addSeatZoneSelector.style.display = 'block';
                    addSeatZoneError.style.display = 'none';
                    if (!addModeZonesInitialized) {
                        let preselect = (mostFrequentZid !== null)
                            ? mostFrequentZid
                            : allZones[0].id;
                        populateAddSeatZoneSelect(preselect);
                        addModeZonesInitialized = true;
                    }
                }
            }
        }
        else if (activeTab === 'map') {
            seatFactory.setReferenceMode(true);
            marquee.hide();
            if (transform) {
                transform.end();
                transform = null;
                marquee.hideRotateGuide();
            }
            seatEditPanel.style.visibility = "hidden";
            if (addSeatZoneSelector) addSeatZoneSelector.style.display = 'none';
            if (addSeatZoneError) addSeatZoneError.style.display = 'none';
        }
        resetCursor();
    }

    // Initialise Materialize tabs. onShow fires when a tab becomes active.
    var tabsInstance = M.Tabs.init(planModifyTabs, {
        onShow: function(el) {
            var id = el.getAttribute('id');
            if (id === 'pm-tab-transform') setMode('transform');
            else if (id === 'pm-tab-add') setMode('add');
            else if (id === 'pm-tab-map') setMode('map');
        }
    });

    // Set initial state (default tab is Transform).
    setMode('transform');

    zoneMapImg.addEventListener('mousedown', function(e) {
        if (activeTab !== 'add') return;

        // Check if there are zones available
        if (allZones.length === 0) {
            if (typeof M !== 'undefined' && M.toast) {
                M.toast({html: TR('You must create a zone before adding seats.'), classes: 'red'});
            }
            return;
        }

        let rect = zoneMapImg.getBoundingClientRect();
        let x = e.clientX - rect.left;
        let y = e.clientY - rect.top;

        // Get selected zone from add-seat zone dropdown
        let selectedZid = addSeatZoneEl ? parseInt(addSeatZoneEl.value) : NaN;
        if (isNaN(selectedZid)) selectedZid = null;

        // If we somehow don't have a zone (race or manual override), fall back to a known zone so
        // we never create a seat without a zid (the backend now requires an explicit zid).
        if (selectedZid === null && allZones.length > 0) {
            selectedZid = (mostFrequentZid !== null) ? mostFrequentZid : allZones[0].id;
        }

        if (selectedZid === null) {
            if (typeof M !== 'undefined' && M.toast) {
                M.toast({html: TR('You must create a zone before adding seats.'), classes: 'red'});
            }
            return;
        }

        seatFactory.createNewSeat(null, x, y);

        let newSeat = seatFactory.getSelectedSeat();
        if (newSeat) {
            newSeat.zid = selectedZid;
        }

        e.stopPropagation();
    }, {signal: ctx.signal});

    let seatDeleteBtnUpdate = function(seat) {
        if (seat.deleted) {
            seatDeleteBtn.innerText = TR('btn.Restore');
            seatDeleteBtn.classList.add('green');
            seatDeleteBtn.classList.remove('red', 'darken-2');
        } else {
            seatDeleteBtn.innerText = TR('btn.Delete');
            seatDeleteBtn.classList.remove('green');
            seatDeleteBtn.classList.add('red', 'darken-2');
        }
    };

    seatDeleteBtn.addEventListener('click', function(e) {
        let seat = seatFactory.getSelectedSeat();
        seatFactory.deleteRestoreSeat(seat);
        seatDeleteBtnUpdate(seat);
    }, {signal: ctx.signal});

    chooseImgBtn.addEventListener('click', function(e) {
        mapUploadInput.click();
    }, {signal: ctx.signal});

    mapUploadInput.addEventListener('change', function(e) {
        if (mapUploadInput.files.length != 1) return;
        zoneMapImg.src = URL.createObjectURL(mapUploadInput.files[0]);
        setDirty();
    }, {signal: ctx.signal});

    saveBtn.addEventListener('click', function(e) {

        if (!isDirty()) return;

        let json = {
            pid: pid
        };

        let data = new FormData();

        if (mapUploadInput.files.length == 1) {
            data.append('image', mapUploadInput.files[0]);
        }

        if (seatFactory.isChanged()) {
            let changes = seatFactory.getChanges();
            Object.assign(json, changes);
        }

        if (isFilterDirty()) {
            json.darkFilter = currentFilterState();
        }

        data.append('json', JSON.stringify(json));

        // Build the change summary as plain translated phrases; the list markup
        // is presentation and is added here, not baked into i18n.
        let lines = [];
        if (data.has('image'))
            lines.push(TR("updated plan map"));
        if ('remove' in json)
            lines.push(TR("deleted %{smart_count} seat(s)", {smart_count: json.remove.length}));

        if ('addOrUpdate' in json) {
            let changedCount = 0;
            for (let i of json.addOrUpdate) {
                if ('sid' in i) ++changedCount;
            }
            let added = json.addOrUpdate.length - changedCount;
            if (added > 0) lines.push(TR("added %{smart_count} seat(s)", {smart_count: added}));
            if (changedCount > 0) lines.push(TR("updated data of %{smart_count} seat(s)", {smart_count: changedCount}));
        }

        if ('darkFilter' in json)
            lines.push(TR("updated map filter"));

        let container = document.createElement('div');
        container.appendChild(document.createTextNode(TR("The following changes will be applied:")));
        let list = container.appendChild(document.createElement('ul'));
        for (let line of lines)
            list.appendChild(document.createElement('li')).innerText = line;

        confirmDelete(
            TR("Are you sure to update the plan?"),
            container.outerHTML,
            { yesText: TR("btn.Yes"), noText: TR("btn.No") }
        ).then((confirmed) => {
            if (!confirmed) return;
            Utils.xhr.post(
                window.warpGlobals.URLs['plansModifyXHR'],
                data,
                {toastOnSuccess: false})
            .then(() => {
                // The changes are now persisted: reset every source isDirty() reads
                // (seat overlay, uploaded map, filter baseline) so the navigate-away
                // below and any later tab close don't re-prompt. The editor is
                // per-mount (fresh SeatFactory each open), so no stale state carries
                // forward.
                seatFactory.clearChanges();
                mapUploadInput.value = '';
                storedFilter = currentFilterState();
                window.sessionStorage.setItem('pendingToast', TR('Action successfull.'));
                ctx.navigate(returnURL);
            });
        });
    }, {signal: ctx.signal});

    seatFactory.on('select', (seat) => {
        if (transform) {
            transform.end();
            transform = null;
            marquee.hideRotateGuide();
        }
        if (activeTab === 'transform') showMarquee();
        seatDeleteBtnUpdate(seat);
        seatNameEl.value = seat.name;
        seatXEl.value = seat.x;
        seatYEl.value = seat.y;
        let zid = seat.zid;
        if (zid === undefined) {
            // New seats: use the add-seat zone dropdown value if in add mode,
            // otherwise fall back to the first available zone
            let dropdownZid = addSeatZoneEl ? parseInt(addSeatZoneEl.value) : NaN;
            if (!isNaN(dropdownZid)) {
                zid = dropdownZid;
            } else if (allZones.length > 0) {
                zid = allZones[0].id;
            }
            if (zid !== undefined) {
                seat.zid = zid;
            }
        }
        populateZoneSelect(zid !== undefined ? zid : null);
        M.updateTextFields();
        // Show the seat edit panel in Transform and Add modes, hide it in Map edit mode.
        seatEditPanel.style.visibility = (activeTab === 'map') ? "hidden" : "visible";

        // Focus the name field so the user can type right away. For new
        // seats whose name is still the auto-generated placeholder, select-all
        // so typing replaces it. Once the user has edited the name (or for
        // existing seats), place the caret at the end for normal editing.
        requestAnimationFrame(() => {
            seatNameEl.focus();
            if (seat.isNew() && !seat.nameChangedFromPlaceholder)
                seatNameEl.select();
        });
    });

    seatFactory.on('unselect', (seat) => {
        seatEditPanel.style.visibility = "hidden";
        if (activeTab === 'transform') showMarquee();
    });

    seatFactory.on('drag', (seat) => {
        seatXEl.value = seat.x;
        seatYEl.value = seat.y;
        if (marquee.active) marquee.update(seatFactory.getTransformSeats());
    });

    seatFactory.on('change', (seat) => {
        setDirty();
        if (marquee.active) marquee.update(seatFactory.getTransformSeats());
    });

    seatFactory.on('init', () => {
        showMarquee();
    });

    seatZoneEl.addEventListener('change', function() {
        let seat = seatFactory.getSelectedSeat();
        if (!seat) return;
        seat.zid = parseInt(this.value) || null;
    }, {signal: ctx.signal});

    let beginTransform = (handle, x, y) => {
        if (activeTab !== 'transform' || !marquee.active) return;

        let rect = zoneMapImg.getBoundingClientRect();
        let transformSeats = seatFactory.getTransformSeats();
        if (transformSeats.length === 0) return;

        transform = new TransformController(rect.width, rect.height, spriteSize);
        transform.begin(handle, transformSeats, seatFactory.getSelectedSeat(), x, y);

        if (handle === 'rotate') {
            marquee.showRotateGuide(transform.pivot, x, y, 0);
            zoneMapContainer.style.cursor = 'grabbing';
        }
    };

    let isSeatAt = (x, y) => seatFactory.seatAt(x, y) !== null;

    let containerMousedownCapture = (e) => {
        seatFactory.suppressDeselect = false;
        if (activeTab !== 'transform' || !marquee.active) return;

        let rect = zoneMapImg.getBoundingClientRect();
        let x = e.clientX - rect.left;
        let y = e.clientY - rect.top;

        if (marquee.isInsideBox(x, y))
            seatFactory.suppressDeselect = true;
    };

    let containerMousedown = (e) => {
        if (activeTab !== 'transform' || !marquee.active) return;

        let rect = zoneMapImg.getBoundingClientRect();
        let x = e.clientX - rect.left;
        let y = e.clientY - rect.top;

        if (marquee.getHandleAt(x, y) === 'box') {
            e.preventDefault();
            beginTransform('box', x, y);
        }
    };

    let updateHoverCursor = (e) => {
        if (transform) return;

        let rect = zoneMapImg.getBoundingClientRect();
        let x = e.clientX - rect.left;
        let y = e.clientY - rect.top;

        if (activeTab === 'add') {
            zoneMapContainer.style.cursor = isSeatAt(x, y) ? 'cell' : 'copy';
            return;
        }

        if (activeTab === 'map') {
            zoneMapContainer.style.cursor = isSeatAt(x, y) ? 'cell' : '';
            return;
        }

        // transform mode
        if (isSeatAt(x, y))
            zoneMapContainer.style.cursor = 'cell';
        else if (marquee.active && marquee.getHandleAt(x, y) === 'box')
            zoneMapContainer.style.cursor = 'move';
        else
            zoneMapContainer.style.cursor = '';
    };

    let containerMousemove = (e) => {
        if (!transform) return;

        let rect = zoneMapImg.getBoundingClientRect();
        let x = e.clientX - rect.left;
        let y = e.clientY - rect.top;

        transform.drag(x, y);

        if (transform.handle === 'rotate')
            marquee.updateRotateGuide(transform.pivot, x, y, transform.lastAngle);
        else
            marquee.update(seatFactory.getTransformSeats());
    };

    let containerMouseup = (e) => {
        if (transform) {
            let wasRotate = transform.handle === 'rotate';
            transform.end();
            transform = null;
            if (wasRotate) {
                marquee.hideRotateGuide();
                showMarquee();
                resetCursor();
            }
            // A completed marquee move/rotate changes seat positions but does not
            // emit a per-seat 'change' event, so reconcile the dirty state here to
            // enable Save. (setDirty() is a no-op if nothing actually moved.)
            setDirty();
        }
    };

    marquee.onHandleMouseDown(beginTransform);

    zoneMapContainer.addEventListener('mousedown', containerMousedownCapture, {capture: true, signal: ctx.signal});
    zoneMapContainer.addEventListener('mousedown', containerMousedown, {signal: ctx.signal});
    zoneMapContainer.addEventListener('mousemove', updateHoverCursor, {signal: ctx.signal});
    window.addEventListener('mousemove', containerMousemove, {signal: ctx.signal});
    window.addEventListener('mouseup', containerMouseup, {signal: ctx.signal});

    // Covers real page unloads (tab close, hard refresh, typing a new URL,
    // navigating to a non-SPA route like /logout). In-SPA route changes are
    // covered by the leave guard registered below (setLeaveGuard).
    let onBeforeUnload = function(e) {
        if (isDirty()) {
            e.preventDefault();
            e.returnValue = '';
        }
    };

    window.addEventListener('beforeunload', onBeforeUnload, {signal: ctx.signal});

    // Single source of truth for "ok to leave the dirty editor?": dirty ->
    // ask the Yes/No confirm; clean -> resolve true. The beforeunload guard
    // above covers real tab unloads; the router leave guard and the Cancel
    // button both route through here so the check lives in one place.
    function confirmLeave() {
        if (!isDirty()) return Promise.resolve(true);
        return confirmDelete(
            TR("Are you sure?"),
            TR("All unsaved changes will be lost."),
            { yesText: TR("btn.Yes"), noText: TR("btn.No") }
        );
    }

    // In-SPA route changes (nav links, back/forward) never fire beforeunload, so
    // register a leave guard the router awaits before navigating away. The
    // Cancel button below also routes through this guard (it just calls
    // ctx.navigate), so confirmLeave is the single point of check for every way
    // out of a dirty editor.
    setLeaveGuard(confirmLeave);

    let cancelBtn = root.querySelector('#cancelBtn');
    cancelBtn.addEventListener('click', function(e) {
        ctx.navigate(returnURL);
    }, {signal: ctx.signal});

    var changeFactory = function(prop) {
        return function(e) {
            let selSeat = seatFactory.getSelectedSeat();
            if (!selSeat) return;
            selSeat[prop] = e.target.value;
            if (prop === 'name')
                selSeat.nameChangedFromPlaceholder = true;
        };
    };

    seatNameEl.addEventListener('input', changeFactory('name'), {signal: ctx.signal});
    seatXEl.addEventListener('input', changeFactory('x'), {signal: ctx.signal});
    seatYEl.addEventListener('input', changeFactory('y'), {signal: ctx.signal});

    var seatXYMax = function() {
        seatXEl.max = zoneMapImg.width - spriteSize;
        seatYEl.max = zoneMapImg.height - spriteSize;
    };

    if (zoneMapImg.complete) seatXYMax();
    zoneMapImg.addEventListener('load', seatXYMax, {signal: ctx.signal});

    seatFactory.updateData();

    // Map image filter controls (dark mode only).
    let filterControls = {
        invert: root.querySelector('#filter_invert'),
        grayscale: root.querySelector('#filter_grayscale'),
        sepia: root.querySelector('#filter_sepia'),
        saturate: root.querySelector('#filter_saturate'),
        hue: root.querySelector('#filter_hue'),
        brightness: root.querySelector('#filter_brightness'),
        contrast: root.querySelector('#filter_contrast'),
    };
    let filterPresetEl = root.querySelector('#map_filter_preset');
    let filterPresets = [];

    // The last-saved filter state, used to detect a dirty filter. Updated after a
    // successful save (see the save handler above).
    let storedFilter = darkFilter || {};

    function filterStateMatches(a, b) {
        let keys = ['id', 'invert', 'grayscale', 'sepia', 'saturate', 'hue', 'brightness', 'contrast'];
        for (let k of keys) {
            let av = a[k] !== undefined ? a[k] : (k === 'id' ? 'custom' : (k === 'hue' ? 0 : (k === 'saturate' || k === 'brightness' || k === 'contrast' ? 100 : 0)));
            let bv = b[k] !== undefined ? b[k] : (k === 'id' ? 'custom' : (k === 'hue' ? 0 : (k === 'saturate' || k === 'brightness' || k === 'contrast' ? 100 : 0)));
            if (av !== bv) return false;
        }
        return true;
    }

    function isFilterDirty() {
        return !filterStateMatches(currentFilterState(), storedFilter);
    }

    function currentFilterState() {
        return {
            id: filterPresetEl ? filterPresetEl.value : 'custom',
            invert: filterControls.invert ? parseInt(filterControls.invert.value) : 0,
            grayscale: filterControls.grayscale ? parseInt(filterControls.grayscale.value) : 0,
            sepia: filterControls.sepia ? parseInt(filterControls.sepia.value) : 0,
            saturate: filterControls.saturate ? parseInt(filterControls.saturate.value) : 100,
            hue: filterControls.hue ? parseInt(filterControls.hue.value) : 0,
            brightness: filterControls.brightness ? parseInt(filterControls.brightness.value) : 100,
            contrast: filterControls.contrast ? parseInt(filterControls.contrast.value) : 100,
        };
    }

    function valuesMatchPreset(storedValues, preset) {
        let keys = ['invert', 'grayscale', 'sepia', 'saturate', 'hue', 'brightness', 'contrast'];
        for (let k of keys) {
            let stored = storedValues[k] !== undefined ? storedValues[k] : (k === 'invert' || k === 'grayscale' || k === 'sepia' || k === 'hue' ? 0 : 100);
            let presetVal = preset[k] !== undefined ? preset[k] : (k === 'invert' || k === 'grayscale' || k === 'sepia' || k === 'hue' ? 0 : 100);
            if (stored !== presetVal) return false;
        }
        return true;
    }

    function resolvePresetId(storedValues) {
        for (let p of filterPresets) {
            if (valuesMatchPreset(storedValues, p)) return p.id;
        }
        return 'custom';
    }

    function loadStoredFilter(stored) {
        let presetId = stored && stored.id;
        let values = Object.assign({}, stored || {});
        // Remove id from values so it doesn't interfere with matching.
        delete values.id;

        // If the stored preset id exists and values match it, use it.
        let resolvedId = 'custom';
        if (presetId && filterPresets.find(p => p.id === presetId) && valuesMatchPreset(values, filterPresets.find(p => p.id === presetId))) {
            resolvedId = presetId;
        } else {
            resolvedId = resolvePresetId(values);
        }

        populateFilterPresets(resolvedId);
        setFilterSliders(values);
    }

    function applyMapFilter() {
        let isDark = document.documentElement.getAttribute('theme') === 'dark';
        if (!isDark) {
            zoneMapImg.style.filter = '';
            return;
        }
        let state = currentFilterState();
        let parts = [];
        parts.push('invert(' + state.invert + '%)');
        parts.push('grayscale(' + state.grayscale + '%)');
        parts.push('sepia(' + state.sepia + '%)');
        parts.push('saturate(' + state.saturate + '%)');
        parts.push('hue-rotate(' + state.hue + 'deg)');
        parts.push('brightness(' + state.brightness + '%)');
        parts.push('contrast(' + state.contrast + '%)');
        zoneMapImg.style.filter = parts.join(' ');
    }

    function setFilterSliders(values) {
        if (filterControls.invert) filterControls.invert.value = values.invert || 0;
        if (filterControls.grayscale) filterControls.grayscale.value = values.grayscale || 0;
        if (filterControls.sepia) filterControls.sepia.value = values.sepia || 0;
        if (filterControls.saturate) filterControls.saturate.value = values.saturate !== undefined ? values.saturate : 100;
        if (filterControls.hue) filterControls.hue.value = values.hue !== undefined ? values.hue : 0;
        if (filterControls.brightness) filterControls.brightness.value = values.brightness !== undefined ? values.brightness : 100;
        if (filterControls.contrast) filterControls.contrast.value = values.contrast !== undefined ? values.contrast : 100;
        applyMapFilter();
    }

    function populateFilterPresets(selectedId) {
        if (!filterPresetEl) return;

        filterPresetEl.innerHTML = '';
        for (let p of filterPresets) {
            let opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = TR('seatEdit.Filter ' + p.id);
            filterPresetEl.appendChild(opt);
        }
        let customOpt = document.createElement('option');
        customOpt.value = 'custom';
        customOpt.textContent = TR('seatEdit.Filter custom');
        filterPresetEl.appendChild(customOpt);

        if (selectedId) filterPresetEl.value = selectedId;

        initFormSelect(filterPresetEl, {
            dropdownOptions: {
                container: filterPresetEl.closest('.zone_modify_sidepanel') || root
            }
        });
    }

    function applyFilterPreset(id) {
        if (id === 'custom') return;
        let preset = filterPresets.find(p => p.id === id);
        if (!preset) return;
        setFilterSliders(preset);
    }

    if (filterPresetEl) {
        filterPresetEl.addEventListener('change', function() {
            setDirty();
            applyFilterPreset(filterPresetEl.value);
        }, {signal: ctx.signal});
    }

    for (let key in filterControls) {
        let el = filterControls[key];
        if (el) {
            // Slider moved by user -> switch the preset selector to Custom and apply.
            // Only rebuild the selector when actually leaving a named preset; rebuilding
            // it on every input event (each step of a drag) caused flicker and churn.
            el.addEventListener('input', function() {
                if (filterPresetEl && filterPresetEl.value !== 'custom')
                    populateFilterPresets('custom');
                setDirty();
                applyMapFilter();
            }, {signal: ctx.signal});
        }
    }

    // Load presets and apply the stored filter once both presets and seat data are ready.
    Utils.xhr.get('/static/map_filter_presets.json', {toastOnSuccess: false})
        .then(function(v) {
            filterPresets = (v.response && v.response.presets) || [];
            loadStoredFilter(storedFilter);
        })
        .catch(function() {
            // If the JSON fails to load, fall back to the neutral/original values.
            filterPresets = [{ id: 'original', invert: 0, grayscale: 0, sepia: 0, saturate: 100, hue: 0, brightness: 100, contrast: 100 }];
            loadStoredFilter(storedFilter);
        });

    // Disconnected in unmount() — it closes over zoneMapImg (part of the
    // discarded #view-root subtree); a leaked observer keeps firing on every
    // subsequent theme toggle even after navigating away.
    themeObserver = new MutationObserver(applyMapFilter);
    themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['theme']
    });

    applyMapFilter();

    // Make sure the add-seat zone select is initialized as Materialize if it's already visible on load
    // (mostly a no-op; actual init happens in populateAddSeatZoneSelect).
    if (addSeatZoneEl) {
        try { initFormSelect(addSeatZoneEl); } catch (e) {}
    }

    return function unmount() {
        if (themeObserver) themeObserver.disconnect();
        clearLeaveGuard();
    };
}

export default { html, mount };
