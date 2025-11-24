// ...existing code...
	const notifBanner = document.getElementById('notifBanner');
	function showBanner(msg, isError) {
		if (!notifBanner) return;
		notifBanner.textContent = msg;
		notifBanner.style.background = isError ? '#e11d48' : '#10b981';
		notifBanner.classList.remove('hidden');
		notifBanner.style.opacity = '1';
		setTimeout(() => {
			notifBanner.style.opacity = '0';
			setTimeout(() => notifBanner.classList.add('hidden'), 350);
		}, 2000);
	}
	// Custom modal for delete vehicle
	const deleteModal = document.getElementById('deleteModal');
	const deleteModalClose = document.getElementById('deleteModalClose');
	const deleteModalCancel = document.getElementById('deleteModalCancel');
	const deleteModalConfirm = document.getElementById('deleteModalConfirm');
	let pendingDeleteVehId = null;

	function showDeleteVehicleModal(vehId) {
		pendingDeleteVehId = vehId;
		deleteModal.classList.remove('hidden');
	}
	function hideDeleteVehicleModal() {
		pendingDeleteVehId = null;
		deleteModal.classList.add('hidden');
	}
	if (deleteModalClose) deleteModalClose.addEventListener('click', hideDeleteVehicleModal);
	if (deleteModalCancel) deleteModalCancel.addEventListener('click', hideDeleteVehicleModal);
	// deleteModalConfirm handler is attached inside DOMContentLoaded (so it can access the page's supabase client)
// pages/customers.js
// Fetch and render customers from Supabase with full CRUD operations


import { getSupabaseClient } from '../helpers/supabase.js';
import { showCustomerRowModal } from '../components/customerRowModal.js';
import { formatTime12 } from '../helpers/utils.js';

let customersArr = [];
let currentCustomerId = null;
let currentCustomerForDelete = null;
let vehicleCountByCustomer = {};


document.addEventListener('DOMContentLoaded', async () => {
			// New Appointment button logic with modal
			const cdNewApptBtn = document.getElementById('cdNewApptBtn');
			const vehSelectModal = document.getElementById('vehSelectModal');
			const vehSelectBody = document.getElementById('vehSelectBody');
			const vehSelectFoot = document.getElementById('vehSelectFoot');
			const vehSelectClose = document.getElementById('vehSelectClose');
			const vehSelectCancel = document.getElementById('vehSelectCancel');

			function closeVehSelectModal() {
				if (vehSelectModal) vehSelectModal.classList.add('hidden');
				if (vehSelectBody) vehSelectBody.innerHTML = '';
				if (vehSelectFoot) {
					// Remove any extra buttons
					Array.from(vehSelectFoot.querySelectorAll('button')).forEach(btn => {
						if (!['vehSelectCancel'].includes(btn.id)) btn.remove();
					});
				}
			}

			if (vehSelectClose) vehSelectClose.addEventListener('click', closeVehSelectModal);
			if (vehSelectCancel) vehSelectCancel.addEventListener('click', closeVehSelectModal);

			if (cdNewApptBtn) {
				cdNewApptBtn.addEventListener('click', async () => {
					const customerId = currentCustomerId;
					if (!customerId) return;
					// Find the customer object from customersArr
					const custObj = customersArr.find(c => c.id === customerId);
					if (!custObj) return;
					const { data: vehicles } = await supabase
						.from('vehicles')
						.select('*')
						.eq('customer_id', customerId);
					const vehs = vehicles || [];
					vehSelectBody.innerHTML = '';
					if (vehs.length === 0) {
						vehSelectBody.innerHTML = '<div class="muted">No vehicles found for this customer.</div>';
						const addBtn = document.createElement('button');
						addBtn.className = 'btn info';
						addBtn.textContent = 'Add New Vehicle';
						addBtn.onclick = () => {
							closeVehSelectModal();
							document.getElementById('cdAddVeh').click();
						};
						vehSelectFoot.appendChild(addBtn);
					} else {
						vehs.forEach((v, i) => {
							const card = document.createElement('div');
							card.className = 'card';
							card.style.marginBottom = '8px';
							card.innerHTML = `<div style="font-weight:600">${v.year || ''} ${v.make || ''} ${v.model || ''} ${v.trim || ''}</div>
								<div class="veh-sub">VIN: ${v.vin || 'N/A'} • Plate: ${v.plate || 'N/A'}</div>`;
							const selectBtn = document.createElement('button');
							selectBtn.className = 'btn info';
							selectBtn.textContent = 'Select Vehicle';
							selectBtn.style.marginTop = '6px';
							selectBtn.onclick = () => {
								// Pass info and redirect
								localStorage.setItem('newApptCustomer', JSON.stringify({
									id: custObj.id,
									customer_first: custObj.customer_first,
									customer_last: custObj.customer_last,
									phone: custObj.phone,
									email: custObj.email
								}));
								localStorage.setItem('newApptVehicle', JSON.stringify(v));
								closeVehSelectModal();
								window.location.href = 'appointments.html#new';
							};
							card.appendChild(selectBtn);
							vehSelectBody.appendChild(card);
						});
						// Add new vehicle option
						const addBtn = document.createElement('button');
						addBtn.className = 'btn';
						addBtn.textContent = 'Add New Vehicle';
						addBtn.onclick = () => {
							closeVehSelectModal();
							document.getElementById('cdAddVeh').click();
						};
						vehSelectFoot.appendChild(addBtn);
					}
					vehSelectModal.classList.remove('hidden');
				});
			}
		// Theme logic for consistent handling
		import('../helpers/user.js').then(({ setThemeFromUser, toggleTheme }) => {
			setThemeFromUser();
			const themeToggle = document.getElementById('themeToggle');
			if (themeToggle) {
				themeToggle.addEventListener('click', toggleTheme);
			}
		});
	console.log('[customers.js] DOMContentLoaded');
	// Create or obtain a single Supabase client instance for this page
	let supabase = null;
	// Prefer the shared helper if available
	try {
		supabase = getSupabaseClient();
	} catch (e) { supabase = null; }

	// If helper didn't return a client yet, wait briefly for vendor and then use a single shared instance
	if (!supabase) {
		const deadline = Date.now() + 5000;
		while (Date.now() < deadline && !window._supabaseClient) {
			if (window.supabase && typeof window.supabase.createClient === 'function') {
				try {
					// Only create if no shared client exists
					if (!window._supabaseClient) {
						window._supabaseClient = window.supabase.createClient(
							'https://hxwufjzyhtwveyxbkkya.supabase.co',
							'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh4d3Vmanp5aHR3dmV5eGJra3lhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI3MjU0MjAsImV4cCI6MjA3ODMwMTQyMH0.nN7MGoYyqwhonOSPBJlFEZoZrOEAIRP79l43FZK5nh8'
						);
					}
					supabase = window._supabaseClient;
					break;
				} catch (e) {
					console.warn('[customers.js] createClient failed, retrying...', e);
				}
			}
			await new Promise(r => setTimeout(r, 200));
		}
	}

	if (!supabase) {
		console.error('[customers.js] Supabase client not available');
		return;
	}

	// Log all invoices for debugging
	try {
		const { data: allInvoices, error: invoiceError } = await supabase
			.from('invoices')
			.select('*');
		if (invoiceError) {
			console.error('[customers.js] Invoice fetch error:', invoiceError);
		} else {
			console.log('[customers.js] All invoices:', allInvoices);
		}
	} catch (e) {
		console.error('[customers.js] Exception fetching invoices:', e);
	}
	const tableBody = document.getElementById('custTbody');
	if (!tableBody) {
		console.error('[customers.js] Table body not found');
		return;
	}

	// Ensure the table header shows "Actions" and center numeric headers (Vehicles, Total Visits)
	try {
		const custTable = tableBody.closest('table');
		if (custTable) {
			const ths = custTable.querySelectorAll('thead th');
			if (ths && ths.length) {
				// Set last header to Actions (matches other pages)
				ths[ths.length - 1].textContent = 'Actions';
				ths[ths.length - 1].style.textAlign = 'center';
				// Attempt to center Vehicles and Total Visits headers if they exist
				if (ths.length > 4) {
					// columns: 0=name,1=phone,2=email,3=vehicles,4=total_visits,5=last_visit,6=actions
					ths[3].style.textAlign = 'center';
					ths[4].style.textAlign = 'center';
				}
			}
		}
	} catch (e) {
		console.warn('[customers.js] Could not adjust table headers:', e);
	}

	// Get current shop ID
	function getCurrentShopId() {
		try {
			const session = JSON.parse(localStorage.getItem('xm_session') || '{}');
			return session.shopId || null;
		} catch (e) {
			return null;
		}
	}

	const shopId = getCurrentShopId();

					// Debug logs for invoices are already printed above in the try block
	// Load customers from Supabase
	async function loadCustomers() {
		try {
			console.log('[customers.js] Loading customers for shop', shopId);
			const { data: customers, error } = await supabase
				.from('customers')
				.select('*')
				.eq('shop_id', shopId);
			if (error) throw error;
			customersArr = customers || [];

			// Load vehicle counts for these customers
			try {
				const { data: vehicles } = await supabase
					.from('vehicles')
					.select('customer_id')
					.eq('shop_id', shopId);
				vehicleCountByCustomer = {};
				(vehicles || []).forEach(v => {
					if (!v || !v.customer_id) return;
					vehicleCountByCustomer[v.customer_id] = (vehicleCountByCustomer[v.customer_id] || 0) + 1;
				});
			} catch (countEx) {
				console.warn('[customers.js] Could not load vehicle counts:', countEx);
				vehicleCountByCustomer = {};
			}
			console.log('[customers.js] Loaded customers:', customersArr.length);
			renderCustomers();
		} catch (ex) {
			console.error('[customers.js] Error loading customers:', ex);
			tableBody.innerHTML = `<tr><td colspan="7">Error loading customers: ${ex.message}</td></tr>`;
		}
	}

	// Render customers table
	function renderCustomers() {
		const empty = document.getElementById('custEmpty');
		
		if (!customersArr.length) {
			tableBody.innerHTML = '';
			if (empty) empty.style.display = 'block';
			return;
		}
		
		if (empty) empty.style.display = 'none';
		

			tableBody.innerHTML = customersArr.map((cust, idx) => {
				const name = ((cust.customer_first || '') + ' ' + (cust.customer_last || '')).trim();
				const phone = cust.phone || '';
				const email = cust.email || '';
				const isMobile = window.matchMedia && window.matchMedia('(max-width: 768px)').matches;
				let row;
				if (isMobile) {
					// Render two cells: visible content cell and a trailing actions cell
					// This prevents the global mobile CSS rule that hides `#custTable td:last-child`
					row = `<tr data-cust-id="${cust.id}"><td class="cust-mobile-cell">${name}${phone ? ' - ' + phone : ''}${email ? ' ' + email : ''}</td><td class="cust-actions"></td></tr>`;
				} else {
					row = `<tr data-cust-id="${cust.id}">
						<td>${name}</td>
						<td>${phone}</td>
						<td>${email}</td>
						<td class="cust-veh">${vehicleCountByCustomer[cust.id] || 0}</td>
						<td class="cust-total">${cust.total_visits || 0}</td>
						<td>${cust.last_visit ? new Date(cust.last_visit).toLocaleDateString() : ''}</td>
						<td class="cust-actions">
							<button class="btn small info btn-view" data-idx="${idx}">View</button>
							<button class="btn small danger btn-delete" data-idx="${idx}" aria-label="Delete customer"><svg width="14" height="14" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><path fill="white" d="M3 6h18v2H3V6zm2 3h14l-1 12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2l-1-12zM9 4V3a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1h5v2H4V4h5z"/></svg></button>
						</td>
					</tr>`;
				}
				return row;
			}).join('');

			// On mobile, make rows clickable to show action modal (View/Delete)
			if (window.matchMedia && window.matchMedia('(max-width: 768px)').matches) {
				tableBody.querySelectorAll('tr').forEach((tr, idx) => {
					tr.classList.add('cust-row-clickable');
					tr.addEventListener('click', (e) => {
						if (e.target.closest('button')) return;
						showCustomerRowModal({
							onView: () => showDrawer(customersArr[idx]),
							onDelete: () => openDeleteConfirmation(customersArr[idx])
						});
					});
				});
			}

		// Add event listeners
		tableBody.querySelectorAll('.btn-view').forEach(btn => {
			btn.addEventListener('click', async () => {
				const idx = btn.getAttribute('data-idx');
				const cust = customersArr[idx];
				console.log('[btn-view] Clicked for customer:', cust);
				await showDrawer(cust);
			});
		});

		tableBody.querySelectorAll('.btn-delete').forEach(btn => {
			btn.addEventListener('click', () => {
				const idx = btn.getAttribute('data-idx');
				const cust = customersArr[idx];
				openDeleteConfirmation(cust);
			});
		});
	}

	// Drawer wiring
	const drawer = document.getElementById('custDrawer');
	const cdTitle = document.getElementById('cdTitle');
	const cdClose = document.getElementById('cdClose');
	const cdFirst = document.getElementById('cdFirst');
	const cdLast = document.getElementById('cdLast');
	const cdPhone = document.getElementById('cdPhone');
	const cdEmail = document.getElementById('cdEmail');
	const cdNotes = document.getElementById('cdNotes');
	const cdSave = document.getElementById('cdSave');
	const cdVehList = document.getElementById('cdVehList');
	const cdApptTbody = document.getElementById('cdApptTbody');
	const cdInvTbody = document.getElementById('cdInvTbody');

	async function showDrawer(cust) {
						// Debug: print customer id and invoice customer field types/values
						console.log('[showDrawer] Customer ID:', cust.id, typeof cust.id);
					// Debug: print current customer id and all invoice customer_id fields
					try {
						const { data: allInvoices, error: invoiceError } = await supabase
							.from('invoices')
							.select('id,customer_id,number,status');
						if (invoiceError) {
							console.error('[showDrawer] Invoice fetch error (all):', invoiceError);
						} else {
							console.log('[showDrawer] Current customer id:', cust.id);
							console.log('[showDrawer] All invoice customer_id fields:', allInvoices.map(inv => ({id: inv.id, customer_id: inv.customer_id, number: inv.number, status: inv.status})));
						}
					} catch (e) {
						console.error('[showDrawer] Exception fetching all invoices:', e);
					}
		if (!drawer) return;
		drawer.classList.remove('hidden');
		cdTitle.textContent = `Customer: ${(cust.customer_first || '') + ' ' + (cust.customer_last || '')}`;
		cdFirst.value = cust.customer_first || '';
		cdLast.value = cust.customer_last || '';
		cdPhone.value = cust.phone || '';
		cdEmail.value = cust.email || '';
		cdNotes.value = cust.notes || '';
		currentCustomerId = cust.id;

		// Load and render vehicles
		await loadVehicles(cust.id);

		// Load appointments
		let appointments = [];
		if (cust.id) {
			const { data: appts } = await supabase
				.from('appointments')
				.select('*')
				.or(`customer_first.eq.${cust.customer_first},phone.eq.${cust.phone}`);
			appointments = appts || [];
		}
		cdApptTbody.innerHTML = appointments.length ? appointments.map(a => `
			<tr>
				<td>${a.preferred_date ? new Date(a.preferred_date).toLocaleDateString() : ''}</td>
				<td>${a.preferred_time ? formatTime12(a.preferred_time) : ''}</td>
				<td>${a.service || ''}</td>
				<td>${a.status || ''}</td>
			</tr>
		`).join('') : '<tr><td colspan="4">No appointments found.</td></tr>';

		// Remove manual refresh button, add auto-refresh
		async function renderInvoices() {
			let invoices = [];
			if (cust.id) {
				try {
					const { data: invs, error } = await supabase
						.from('invoices')
						.select('*')
						.eq('customer_id', cust.id);
					if (error) {
						console.error('Supabase invoice fetch error:', error);
					} else {
						console.log('Supabase invoice fetch result:', invs);
					}
					invoices = invs || [];
					console.log('[showDrawer] Invoice statuses for customer', cust.id, ':', invoices.map(inv => ({number: inv.number, status: inv.status})));
				} catch (e) {
					console.error('Exception during invoice fetch:', e);
				}
			}
			cdInvTbody.innerHTML = invoices.length ? invoices.map(inv => `
				<tr>
					<td>${inv.created_at ? new Date(inv.created_at).toLocaleDateString() : ''}</td>
					<td>${inv.number || ''}</td>
					<td>$${calculateInvoiceTotal(inv).toFixed(2)}</td>
					<td>${inv.status || ''}</td>
				</tr>
			`).join('') : '<tr><td colspan="4">No invoices found.</td></tr>';
		}

		// Initial render
		await renderInvoices();

	}
	function calculateInvoiceTotal(inv) {
		const items = inv.items || [];
		const subtotal = items.reduce((sum, item) => sum + (item.qty * item.price), 0);
		const tax = subtotal * ((inv.tax_rate || 0) / 100);
		const discount = subtotal * ((inv.discount || 0) / 100);
		return subtotal + tax - discount;
	}

	// Load vehicles for a customer
	async function loadVehicles(customerId) {
		try {
					const { data: vehicles } = await supabase
						.from('vehicles')
						.select('*')
						.eq('customer_id', customerId)
						.order('is_primary', { ascending: false });
			
			const vehs = vehicles || [];
			
			cdVehList.innerHTML = vehs.length ? vehs.map(v => `
				<div class="veh-card card" style="padding:12px; position:relative">
					<button class="veh-star" data-veh-id="${v.id}" title="Set primary" style="position:absolute; right:8px; top:8px; border:none; background:transparent; font-size:18px; cursor:pointer; color:${v.is_primary ? '#f59e0b' : '#9ca3af'}">${v.is_primary ? '★' : '☆'}</button>
					<div class="veh-title" style="font-weight:600">${v.year || ''} ${v.make || ''} ${v.model || ''} ${v.trim || ''}</div>
					<div class="veh-sub">VIN: ${v.vin || 'N/A'} • Plate: ${v.plate || 'N/A'}</div>
					${v.vehicle_notes ? `<div class="veh-sub" style="margin-top:4px">${v.vehicle_notes}</div>` : ''}
					<div class="veh-card-actions" style="margin-top:8px">
						<button class="btn small danger" data-veh-id="${v.id}" aria-label="Delete vehicle"><svg width="14" height="14" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><path fill="white" d="M3 6h18v2H3V6zm2 3h14l-1 12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2l-1-12zM9 4V3a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1h5v2H4V4h5z"/></svg></button>
					</div>
				</div>
			`).join('') : '<div class="muted">No vehicles found.</div>';

			// Add listeners: star (set primary) and delete (custom modal)
			cdVehList.querySelectorAll('.veh-star').forEach(star => {
				star.addEventListener('click', async (e) => {
					e.stopPropagation();
					const vehId = star.getAttribute('data-veh-id');
					if (!vehId) return;
					try {
						// Set all vehicles for this customer to is_primary = false
						const { error: err1 } = await supabase
							.from('vehicles')
							.update({ is_primary: false })
							.eq('customer_id', customerId);
						if (err1) throw err1;

						// Set selected vehicle to primary
						const { error: err2 } = await supabase
							.from('vehicles')
							.update({ is_primary: true, updated_at: new Date().toISOString() })
							.eq('id', vehId);
						if (err2) throw err2;

						await loadVehicles(customerId);
						showBanner('Primary vehicle updated!');
					} catch (ex) {
						console.error('[customers.js] Error setting primary vehicle:', ex);
						showBanner('Error setting primary vehicle: ' + ex.message, true);
					}
				});
			});

			cdVehList.querySelectorAll('button[data-veh-id]').forEach(btn => {
				// Skip star buttons
				if (btn.classList.contains('veh-star')) return;
				btn.addEventListener('click', async () => {
					const vehId = btn.getAttribute('data-veh-id');
					showDeleteVehicleModal(vehId);
				});
			});
		} catch (ex) {
			console.error('Error loading vehicles:', ex);
			cdVehList.innerHTML = '<div class="muted">Error loading vehicles</div>';
		}
	}

	// Delete vehicle
	async function deleteVehicle(vehId) {
		try {
					const { error } = await supabase
						.from('vehicles')
						.delete()
						.eq('id', vehId);
			
			if (error) throw error;
			
			// Reload vehicles
			await loadVehicles(currentCustomerId);
		} catch (ex) {
			showBanner('Error deleting vehicle: ' + ex.message, true);
		}
	}

	// Save customer updates
	if (cdSave) {
		cdSave.addEventListener('click', async () => {
			if (!currentCustomerId) return;
			
			const updates = {
				customer_first: cdFirst.value.trim(),
				customer_last: cdLast.value.trim(),
				phone: cdPhone.value.trim(),
				email: cdEmail.value.trim(),
				notes: cdNotes.value.trim(),
				updated_at: new Date().toISOString()
			};
			
			try {
				const { error } = await supabase
					.from('customers')
					.update(updates)
					.eq('id', currentCustomerId);
				
				if (error) throw error;
				
				// Update local array
				const idx = customersArr.findIndex(c => c.id === currentCustomerId);
				if (idx !== -1) {
					customersArr[idx] = { ...customersArr[idx], ...updates };
				}
				
				renderCustomers();
				showBanner('Customer updated!');
			} catch (ex) {
				showBanner('Error updating customer: ' + ex.message, true);
			}
		});
	}

	if (cdClose) {
		cdClose.addEventListener('click', () => {
			drawer.classList.add('hidden');
		});
	}

	// Add Vehicle modal wiring
	const vehModal = document.getElementById('vehModal');
	const vehClose = document.getElementById('vehClose');
	const vehCancel = document.getElementById('vehCancel');
	const vehSave = document.getElementById('vehSave');
	const vehVin = document.getElementById('vehVin');
	const vehPlate = document.getElementById('vehPlate');
	const vehYear = document.getElementById('vehYear');
	const vehMake = document.getElementById('vehMake');
	const vehModel = document.getElementById('vehModel');
	const vehTrim = document.getElementById('vehTrim');
	const vehNotes = document.getElementById('vehNotes');
	const vehPrimary = document.getElementById('vehPrimary');

	// Show Add Vehicle modal
	const cdAddVeh = document.getElementById('cdAddVeh');
	if (cdAddVeh && vehModal) {
		cdAddVeh.addEventListener('click', () => {
			// Clear form
			vehVin.value = '';
			vehPlate.value = '';
			vehYear.value = '';
			vehMake.value = '';
			vehModel.value = '';
			vehTrim.value = '';
			vehNotes.value = '';
			vehPrimary.checked = false;
			
			vehModal.classList.remove('hidden');
		});
	}
	
	if (vehClose && vehModal) {
		vehClose.addEventListener('click', () => {
			vehModal.classList.add('hidden');
		});
	}
	
	if (vehCancel && vehModal) {
		vehCancel.addEventListener('click', () => {
			vehModal.classList.add('hidden');
		});
	}

	// Save vehicle to Supabase
	if (vehSave) {
		vehSave.addEventListener('click', async () => {
			if (!currentCustomerId) return;
			
			const payload = {
				id: crypto.randomUUID(),
				customer_id: currentCustomerId,
				shop_id: shopId,
				vin: vehVin.value.trim(),
				year: vehYear.value.trim(),
				make: vehMake.value.trim(),
				model: vehModel.value.trim(),
				trim: vehTrim.value.trim(),
				plate: vehPlate.value.trim(),
				vehicle_notes: vehNotes.value.trim(),
				is_primary: vehPrimary.checked,
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString()
			};
			
			try {
								console.log('[customers.js] Adding vehicle:', payload);
								const { error } = await supabase
									.from('vehicles')
									.insert([payload]);
								if (error) throw error;
								vehModal.classList.add('hidden');
								await loadVehicles(currentCustomerId);
								showBanner('Vehicle added!');
							} catch (ex) {
								console.error('[customers.js] Error saving vehicle:', ex);
								showBanner('Error saving vehicle: ' + ex.message, true);
							}
		});
	}

	// New Customer Modal
	const btnNewCustomer = document.getElementById('btnNewCustomer');
	const custModal = document.getElementById('custModal');
	const custModalClose = document.getElementById('custModalClose');
	const newCustCancel = document.getElementById('newCustCancel');
	const newCustSave = document.getElementById('newCustSave');
	const newCustFirst = document.getElementById('newCustFirst');
	const newCustLast = document.getElementById('newCustLast');
	const newCustPhone = document.getElementById('newCustPhone');
	const newCustEmail = document.getElementById('newCustEmail');
	const newCustNotes = document.getElementById('newCustNotes');

	if (btnNewCustomer) {
		btnNewCustomer.addEventListener('click', () => {
			// Clear form
			newCustFirst.value = '';
			newCustLast.value = '';
			newCustPhone.value = '';
			newCustEmail.value = '';
			newCustNotes.value = '';
			
			custModal.classList.remove('hidden');
		});
	}

	// If page was opened with #new fragment, open the New Customer modal automatically
	if (window.location.hash === '#new') {
		try {
			if (newCustFirst) newCustFirst.value = '';
			if (newCustLast) newCustLast.value = '';
			if (newCustPhone) newCustPhone.value = '';
			if (newCustEmail) newCustEmail.value = '';
			if (newCustNotes) newCustNotes.value = '';
			if (custModal) {
				custModal.classList.remove('hidden');
				setTimeout(() => { if (newCustFirst) newCustFirst.focus(); }, 60);
			}
		} catch (e) {
			console.warn('[customers.js] Failed to auto-open new customer modal from hash:', e);
		}
	}

	if (custModalClose) {
		custModalClose.addEventListener('click', () => {
			custModal.classList.add('hidden');
		});
	}

	if (newCustCancel) {
		newCustCancel.addEventListener('click', () => {
			custModal.classList.add('hidden');
		});
	}

	if (newCustSave) {
		newCustSave.addEventListener('click', async () => {
			const first = newCustFirst.value.trim();
			const last = newCustLast.value.trim();
			const phone = newCustPhone.value.trim();
			const email = newCustEmail.value.trim();
			const notes = newCustNotes.value.trim();

			if (!first || !last) {
				showBanner('First and last name are required', true);
				return;
			}

			const payload = {
				id: crypto.randomUUID(),
				shop_id: shopId,
				customer_first: first,
				customer_last: last,
				phone: phone,
				email: email,
				notes: notes,
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString()
			};

			try {
							console.log('[customers.js] Creating customer:', payload);
							const { data, error } = await supabase
								.from('customers')
								.insert([payload])
								.select()
								.single();

				if (error) throw error;

				customersArr.push(data);
				renderCustomers();
				custModal.classList.add('hidden');
				showBanner('Customer created!');
			} catch (ex) {
				showBanner('Error creating customer: ' + ex.message, true);
			}
		});
	}

	// Delete confirmation modal
	const confirmModal = document.getElementById('confirmModal');
	const confClose = document.getElementById('confClose');
	const confCancel = document.getElementById('confCancel');
	const confDelete = document.getElementById('confDelete');
	const confMsg = document.getElementById('confMsg');

	function openDeleteConfirmation(customer) {
		currentCustomerForDelete = customer;
		confMsg.textContent = `Delete customer "${customer.customer_first} ${customer.customer_last}"? This will also delete all their vehicles.`;
		confirmModal.classList.remove('hidden');
	}

	if (confClose) {
		confClose.addEventListener('click', () => {
			confirmModal.classList.add('hidden');
			currentCustomerForDelete = null;
		});
	}

	if (confCancel) {
		confCancel.addEventListener('click', () => {
			confirmModal.classList.add('hidden');
			currentCustomerForDelete = null;
		});
	}

	// Unified customer delete function
	async function deleteCustomer(customer) {
		try {
			// Delete vehicles first
			console.log('[customers.js] Deleting customer and vehicles:', customer.id);
			await supabase
				.from('vehicles')
				.delete()
				.eq('customer_id', customer.id);

			// Only delete customer, do NOT delete appointments, jobs, or invoices
			const { error } = await supabase
				.from('customers')
				.delete()
				.eq('id', customer.id);

			if (error) throw error;

			customersArr = customersArr.filter(c => c.id !== customer.id);
			renderCustomers();
			confirmModal.classList.add('hidden');
			currentCustomerForDelete = null;
			showBanner('Customer deleted!');
		} catch (ex) {
			showBanner('Error deleting customer: ' + ex.message, true);
		}
	}

	if (confDelete) {
		confDelete.addEventListener('click', async () => {
			if (!currentCustomerForDelete) return;
			await deleteCustomer(currentCustomerForDelete);
		});
	}

	// Vehicle delete confirmation (uses page-level supabase)
	if (deleteModalConfirm) {
		deleteModalConfirm.addEventListener('click', async () => {
			if (!pendingDeleteVehId) return;
			try {
				const { error } = await supabase
					.from('vehicles')
					.delete()
					.eq('id', pendingDeleteVehId);
				if (error) throw error;
				await loadVehicles(currentCustomerId);
				showBanner('Vehicle deleted!');
			} catch (ex) {
				showBanner('Error deleting vehicle: ' + ex.message, true);
			}
			hideDeleteVehicleModal();
		});
	}

	// Search functionality
	const custSearch = document.getElementById('custSearch');
	if (custSearch) {
		custSearch.addEventListener('input', () => {
			const term = custSearch.value.toLowerCase();
			
			if (!term) {
				renderCustomers();
				return;
			}

			const filtered = customersArr.filter(c => 
				(c.customer_first || '').toLowerCase().includes(term) ||
				(c.customer_last || '').toLowerCase().includes(term) ||
				(c.phone || '').includes(term) ||
				(c.email || '').toLowerCase().includes(term) ||
				(c.vehicle || '').toLowerCase().includes(term) ||
				(c.vin || '').toLowerCase().includes(term)
			);

			const empty = document.getElementById('custEmpty');
			
			if (!filtered.length) {
				tableBody.innerHTML = '';
				if (empty) {
					empty.style.display = 'block';
					empty.textContent = 'No customers match your search.';
				}
				return;
			}

			if (empty) empty.style.display = 'none';
			
			tableBody.innerHTML = filtered.map((cust, idx) => `
				<tr data-cust-id="${cust.id}">
					<td>${(cust.customer_first || '') + ' ' + (cust.customer_last || '')}</td>
					<td>${cust.phone || ''}</td>
					<td>${cust.email || ''}</td>
					<td style="text-align:center">${vehicleCountByCustomer[cust.id] || 0}</td>
					<td style="text-align:center">${cust.total_visits || 0}</td>
					<td>${cust.last_visit ? new Date(cust.last_visit).toLocaleDateString() : ''}</td>
					<td>
						<button class="btn btn-view" data-cust-id="${cust.id}">View</button>
						<button class="btn btn-delete danger" data-cust-id="${cust.id}" aria-label="Delete customer"><svg width="14" height="14" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><path fill="white" d="M3 6h18v2H3V6zm2 3h14l-1 12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2l-1-12zM9 4V3a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1h5v2H4V4h5z"/></svg></button>
					</td>
				</tr>
			`).join('');

			// Re-attach event listeners
			tableBody.querySelectorAll('.btn-view').forEach(btn => {
				btn.addEventListener('click', async () => {
					const custId = btn.getAttribute('data-cust-id');
					const cust = customersArr.find(c => c.id === custId);
					if (cust) await showDrawer(cust);
				});
			});

			tableBody.querySelectorAll('.btn-delete').forEach(btn => {
				btn.addEventListener('click', () => {
					const custId = btn.getAttribute('data-cust-id');
					const cust = customersArr.find(c => c.id === custId);
					if (cust) openDeleteConfirmation(cust);
				});
			});
		});
	}

	// Backfill button - migrate customers from appointments
	const btnBackfill = document.getElementById('btnBackfill');
	if (btnBackfill) {
		btnBackfill.addEventListener('click', async () => {
			if (!confirm('Backfill customers from appointments? This will create customer records for any appointments that don\'t have matching customers.')) {
				return;
			}

			try {
				// Load appointments
							const { data: appointments } = await supabase
								.from('appointments')
								.select('*')
								.eq('shop_id', shopId);

				let created = 0;

				for (const appt of appointments || []) {
					// Check if customer already exists
					const existing = customersArr.find(c => 
						c.phone === appt.phone || c.email === appt.email
					);

					if (!existing && (appt.customer_first || appt.phone)) {
						const payload = {
							id: crypto.randomUUID(),
							shop_id: shopId,
							customer_first: appt.customer_first || '',
							customer_last: appt.customer_last || '',
							phone: appt.phone || '',
							email: appt.email || '',
							vehicle: appt.vehicle || '',
							vin: appt.vin || '',
							created_at: new Date().toISOString(),
							updated_at: new Date().toISOString()
						};

										const { error } = await supabase
											.from('customers')
											.insert([payload]);

						if (!error) {
							customersArr.push(payload);
							created++;
						}
					}
				}

				await loadCustomers();
				alert(`Backfill complete! Created ${created} customer records.`);
			} catch (ex) {
				alert('Error during backfill: ' + ex.message);
			}
		});
	}

	// Export CSV button
	const btnExport = document.getElementById('btnExport');
	if (btnExport) {
		btnExport.addEventListener('click', () => {
			const headers = ['First Name', 'Last Name', 'Phone', 'Email', 'Vehicle', 'VIN', 'Notes'];
			const rows = customersArr.map(c => [
				c.customer_first || '',
				c.customer_last || '',
				c.phone || '',
				c.email || '',
				c.vehicle || '',
				c.vin || '',
				c.notes || ''
			]);

			const csv = [headers, ...rows].map(row => 
				row.map(cell => `"${cell}"`).join(',')
			).join('\n');

			const blob = new Blob([csv], { type: 'text/csv' });
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `customers-${new Date().toISOString().slice(0,10)}.csv`;
			a.click();
			URL.revokeObjectURL(url);
		});
	}

	// Initial load
	await loadCustomers();
});
