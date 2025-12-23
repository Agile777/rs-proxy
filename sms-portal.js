/**
 * SMS Portal JavaScript with Notification System Integration
 * Handles SMS sending functionality, staff selection, and real-time notifications
 */

// Global variables
let staffData = [];
let siteData = [];
let departmentData = [];
let positionData = []; // Will represent job titles now
let messageTemplates = {};
let selectedRecipients = [];
// Customer and assignment data (for linking customers ⇄ sites ⇄ staff)
let customerData = [];
let staffAssignments = [];
let smsBalance = 5000; // Will be fetched from API in production
let notificationSystem = null;
let accessToken = null;
let tokenExpiry = null;
let smsAPI = null; // Will be initialized when SMSAPIHandler is available

/**
 * Get access token for SMS API
 */
async function getAccessToken() {
    // Check if we have a valid token
    if (accessToken && tokenExpiry && new Date() < tokenExpiry) {
        return accessToken;
    }
    
    const { CLIENT_ID, CLIENT_SECRET, BASE_URL } = window.RETAIL_CONFIG.SMS_API;
    
    try {
        const response = await fetch(`${BASE_URL}/auth/token`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET,
                grant_type: 'client_credentials'
            })
        });
        
        if (response.ok) {
            const data = await response.json();
            accessToken = data.access_token;
            // Set expiry to 1 hour from now (or use expires_in from response)
            tokenExpiry = new Date(Date.now() + (data.expires_in || 3600) * 1000);
            console.log('✅ SMS API: Authentication successful');
            return accessToken;
        } else {
            const errorData = await response.json().catch(() => ({ message: 'Authentication failed' }));
            throw new Error(`Authentication failed: ${errorData.message || response.status}`);
        }
    } catch (error) {
        console.error('Error getting access token:', error);
        
        if (notificationSystem) {
            notificationSystem.show({
                type: 'error',
                title: 'SMS Authentication Failed',
                message: 'Unable to authenticate with SMS service. Please check your internet connection and API credentials.',
                category: 'sms',
                duration: 8000
            });
        }
        
        throw error;
    }
}

// Initialize the application when DOM is fully loaded
document.addEventListener('DOMContentLoaded', function() {
    // Wait for notification system to be available
    setTimeout(() => {
        if (window.notificationSystem) {
            notificationSystem = window.notificationSystem;
            console.log('✅ SMS Portal: Notification system connected');
        }
        
        initializeApplication();
    }, 100);
});

/**
 * Initialize all components of the application
 */
async function initializeApplication() {
    try {
        // Enforce authentication before loading anything
        if (window.authHelpers?.requireAuth) {
            const ok = await window.authHelpers.requireAuth();
            if (!ok) return; // Will redirect to login
        }

        // Identify current user and super user status
        try {
            const supabase = await (window.waitForSupabaseClient ? window.waitForSupabaseClient() : null);
            const { data } = await supabase?.auth?.getUser();
            const email = data?.user?.email || localStorage.getItem('username') || null;
            window.currentUserEmail = email;
            window.isSuperUser = email && email.toLowerCase() === 'leonopperman1971@gmail.com';
            // Update navbar if elements exist
            const userLabel = document.getElementById('navUserLabel');
            if (userLabel && email) {
                userLabel.textContent = email + (window.isSuperUser ? ' (Super User)' : '');
            }
        } catch (e) {
            console.warn('Auth user detection failed:', e);
        }
        // Initialize SMS API if available
        if (typeof SMSAPIHandler !== 'undefined') {
            try {
                console.log('🔍 Checking RETAIL_CONFIG:', window.RETAIL_CONFIG);
                console.log('🔍 SMS_API config:', window.RETAIL_CONFIG?.SMS_API);
                smsAPI = new SMSAPIHandler();
                console.log('✅ SMS Portal: API handler initialized');
            } catch (err) {
                console.error('❌ Failed to initialize SMS API handler:', err);
                console.error('Error details:', err.message);
            }
        } else {
            console.error('❌ SMSAPIHandler class not found!');
        }
        
        initializeSelectElements();
        loadTemplates();
        setupEventListeners();
        
        // Load all data in parallel for faster initialization
        await Promise.all([
            loadCustomerData(),
            loadStaffData(),
            loadRecentSMS(),
            smsAPI ? updateSMSBalance() : Promise.resolve(),
            smsAPI ? updateHeroStats() : Promise.resolve()
        ]);
        
        // Initialize contacts management
        initializeContacts();
        
        // Set default balance display if API not available
        if (!smsAPI) {
            smsBalance = 1000;
            $('#smsBalance').text(smsBalance.toLocaleString());
            $('#heroCredits').text(smsBalance.toLocaleString());
            $('#heroSentToday').text('0');
        }
        
        updateSMSSummary();
        
        // Show green "Ready for Use" notification
        if (notificationSystem) {
            notificationSystem.show({
                type: 'success',
                title: '✓ Ready for Use',
                message: 'SMS Portal is ready. All systems loaded successfully.',
                category: 'sms',
                duration: 5000
            });
        }
    } catch (error) {
        console.error('Error during application initialization:', error);
        
        if (notificationSystem) {
            notificationSystem.show({
                type: 'error',
                title: 'Initialization Error',
                message: 'Some features may not be available.',
                category: 'sms',
                duration: 6000
            });
        }
    }
}

/**
 * Initialize Select2 dropdowns and other select elements
 */
function initializeSelectElements() {
    // Initialize Select2 for enhanced dropdowns
    $('.select2').select2({
        placeholder: "Select options",
        allowClear: true,
        width: '100%'
    });
    
    // Handle recipient type change
    $('#recipientType').on('change', function() {
        // Hide all recipient sections
        $('.recipient-section').addClass('d-none');
        
        // Show the selected section
        const selectedType = $(this).val();
        switch(selectedType) {
            case 'individual':
                $('#individualSelection').removeClass('d-none');
                break;
            case 'site':
                $('#siteSelection').removeClass('d-none');
                break;
            case 'department':
                $('#departmentSelection').removeClass('d-none');
                break;
            case 'position': // Job Title
                $('#positionSelection').removeClass('d-none');
                break;
            case 'mobile':
                $('#mobileSelection').removeClass('d-none');
                break;
            case 'all':
                // No specific section to show for "all"
                break;
        }
        
        updateRecipientCount();
    });

    // Customer filter changes should re-populate dependent dropdowns and counts
    $('#customerSelect').on('change', function() {
        // When customer changes, refresh sites and staff lists
        populateSiteDropdown();
        populateStaffDropdown();
        // Clear selections that might now be invalid
        $('#siteSelect').val(null).trigger('change');
        $('#staffSelect').val(null).trigger('change');
        updateRecipientCount();
    });
}

/**
 * Set up all event listeners for the page
 */
function setupEventListeners() {
    // Message character counter
    $('#messageText').on('input', function() {
        updateCharacterCount();
    });
    
    // Template selection
    $('#messageTemplate').on('change', function() {
        const templateId = $(this).val();
        if (templateId && messageTemplates[templateId]) {
            $('#messageText').val(messageTemplates[templateId].content);
            updateCharacterCount();
        }
    });
    
    // Save template button
    $('#saveTemplate').on('click', function() {
        const currentMessage = $('#messageText').val();
        if (currentMessage.trim() === '') {
            showToast('Error', 'Please enter a message before saving a template', 'error');
            return;
        }
        
        $('#templatePreview').text(currentMessage);
        const modal = new bootstrap.Modal(document.getElementById('saveTemplateModal'));
        modal.show();
    });
    
    // Confirm save template button
    $('#confirmSaveTemplateBtn').on('click', function() {
        const templateName = $('#templateName').val();
        const templateContent = $('#messageText').val();
        
        if (templateName.trim() === '') {
            showToast('Error', 'Please enter a template name', 'error');
            return;
        }
        
        saveMessageTemplate(templateName, templateContent);
        const modal = bootstrap.Modal.getInstance(document.getElementById('saveTemplateModal'));
        modal.hide();
    });
    
    // Schedule message checkbox
    $('#scheduleMessage').on('change', function() {
        if (this.checked) {
            $('#scheduleOptions').removeClass('d-none');
        } else {
            $('#scheduleOptions').addClass('d-none');
        }
    });
    
    // Tag insertion buttons
    $('.tag-btn').on('click', function() {
        const tag = $(this).data('tag');
        const messageField = $('#messageText');
        const cursorPos = messageField.prop('selectionStart');
        const currentText = messageField.val();
        
        const newText = currentText.substring(0, cursorPos) + tag + currentText.substring(cursorPos);
        messageField.val(newText);
        messageField.focus();
        updateCharacterCount();
    });
    
    // Preview button
    $('#previewBtn').on('click', function() {
        if (!validateForm()) {
            return;
        }
        
        showMessagePreview();
    });
    
    // Send SMS form submission
    $('#smsForm').on('submit', function(e) {
        e.preventDefault();
        
        if (!validateForm()) {
            return;
        }
        
        sendSMS();
    });
    
    // Confirm send button in preview modal
    $('#confirmSendBtn').on('click', function() {
        const modal = bootstrap.Modal.getInstance(document.getElementById('previewModal'));
        modal.hide();
        sendSMS();
    });
    
    // Top up button
    $('#topUpBtn').on('click', function() {
        if (notificationSystem) {
            notificationSystem.show({
                type: 'info',
                title: 'Redirecting to Top Up',
                message: 'Opening ASMS Portal top-up page in new window...',
                category: 'sms',
                duration: 3000
            });
        }
        window.open('https://asmsportal.com/topup', '_blank');
    });
    
    // View all SMS history button
    $('#viewAllSmsBtn').on('click', function(e) {
        e.preventDefault();
        window.location.href = 'sms-reports.html';
    });
    
    // Staff selection change
    $('#staffSelect').on('change', function() {
        updateSelectedCount();
        updateRecipientCount();
        updateSMSSummary();
    });
    
    // Site selection change
    $('#siteSelect').on('change', function() {
        updateRecipientCount();
        updateSMSSummary();
    });
    
    // Department selection change
    $('#departmentSelect').on('change', function() {
        updateRecipientCount();
        updateSMSSummary();
    });
    
    // Job Title selection change
    $('#positionSelect').on('change', function() {
        updateRecipientCount();
        updateSMSSummary();
    });
    
    // Mobile numbers input change
    $('#mobileNumbers').on('input', function() {
        updateMobileCount();
        updateRecipientCount();
        updateSMSSummary();
    });
    
    // Validate mobile numbers button
    $('#validateNumbers').on('click', function() {
        validateMobileNumbers();
    });
}

/**
 * Update mobile number count display
 */
function updateMobileCount() {
    const mobileText = $('#mobileNumbers').val();
    const numbers = extractMobileNumbers(mobileText);
    const count = numbers.length;
    
    $('#mobileCount').text(`${count} number${count !== 1 ? 's' : ''} entered`);
    
    if (count > 0) {
        $('#mobileCount').removeClass('bg-secondary').addClass('bg-info');
    } else {
        $('#mobileCount').removeClass('bg-info').addClass('bg-secondary');
    }
}

/**
 * Extract and clean mobile numbers from text input
 */
function extractMobileNumbers(text) {
    if (!text || text.trim() === '') {
        return [];
    }
    
    // Split by newlines and commas, then clean each number
    const rawNumbers = text.split(/[\n,]+/).map(num => num.trim()).filter(num => num.length > 0);
    const cleanNumbers = [];
    
    for (let number of rawNumbers) {
        const cleaned = cleanMobileNumber(number);
        if (cleaned) {
            cleanNumbers.push(cleaned);
        }
    }
    
    // Remove duplicates
    return [...new Set(cleanNumbers)];
}

/**
 * Clean and format a mobile number
 */
function cleanMobileNumber(number) {
    // Remove all non-numeric characters except +
    let cleaned = number.replace(/[^+\d]/g, '');
    
    if (cleaned === '') {
        return null;
    }
    
    // Handle South African numbers
    if (cleaned.startsWith('0')) {
        // Convert 0123456789 to +27123456789
        cleaned = '+27' + cleaned.substring(1);
    } else if (cleaned.startsWith('27') && !cleaned.startsWith('+27')) {
        // Convert 27123456789 to +27123456789
        cleaned = '+' + cleaned;
    } else if (!cleaned.startsWith('+')) {
        // If no country code, assume South Africa
        cleaned = '+27' + cleaned;
    }
    
    // Validate length (South African mobile should be +27 + 9 digits = 12 chars)
    if (cleaned.startsWith('+27') && cleaned.length === 12) {
        return cleaned;
    } else if (cleaned.startsWith('+') && cleaned.length >= 10) {
        // Allow other international numbers
        return cleaned;
    }
    
    return null;
}

/**
 * Validate all entered mobile numbers
 */
function validateMobileNumbers() {
    const mobileText = $('#mobileNumbers').val();
    const rawNumbers = mobileText.split(/[\n,]+/).map(num => num.trim()).filter(num => num.length > 0);
    const validNumbers = [];
    const invalidNumbers = [];
    
    for (let number of rawNumbers) {
        const cleaned = cleanMobileNumber(number);
        if (cleaned) {
            validNumbers.push({ original: number, cleaned: cleaned });
        } else {
            invalidNumbers.push(number);
        }
    }
    
    // Display validation results
    let html = '<div class="border rounded p-2 mt-2">';
    
    if (validNumbers.length > 0) {
        html += `<div class="mb-2"><strong class="text-success">✅ Valid Numbers (${validNumbers.length}):</strong><br>`;
        validNumbers.forEach(num => {
            if (num.original !== num.cleaned) {
                html += `<small class="text-muted">${num.original} → ${num.cleaned}</small><br>`;
            } else {
                html += `<small class="text-success">${num.cleaned}</small><br>`;
            }
        });
        html += '</div>';
    }
    
    if (invalidNumbers.length > 0) {
        html += `<div><strong class="text-danger">❌ Invalid Numbers (${invalidNumbers.length}):</strong><br>`;
        invalidNumbers.forEach(num => {
            html += `<small class="text-danger">${num}</small><br>`;
        });
        html += '</div>';
    }
    
    html += '</div>';
    
    $('#mobileValidation').html(html).show();
    
    if (validNumbers.length > 0 && invalidNumbers.length === 0) {
        showToast('Success', `All ${validNumbers.length} numbers are valid!`, 'success');
    } else if (validNumbers.length > 0 && invalidNumbers.length > 0) {
        showToast('Partial Success', `${validNumbers.length} valid, ${invalidNumbers.length} invalid numbers`, 'warning');
    } else {
        showToast('Error', 'No valid mobile numbers found', 'error');
    }
    
    updateRecipientCount();
    updateSMSSummary();
}

/**
 * Load message templates from storage or API
 */
function loadTemplates() {
    // In a real app, these would come from database
    // For now, we'll use some predefined templates
    messageTemplates = {
        'shift_reminder': {
            name: 'Shift Reminder',
            content: 'Hi {name}, this is a reminder of your upcoming shift at {site} on {shift_date} at {shift_time}. Please arrive 15 minutes early. Reply CONFIRM to acknowledge.'
        },
        'urgent_shift': {
            name: 'Urgent Shift Coverage',
            content: 'URGENT: We need shift coverage at {site} on {shift_date} from {shift_time}. Please reply YES if you can cover this shift. Thank you!'
        },
        'general_announcement': {
            name: 'General Announcement',
            content: 'NOTICE: {name}, please be informed that there will be a staff meeting on {shift_date} at {shift_time}. Your attendance is required.'
        },
        'payment_notification': {
            name: 'Payment Notification',
            content: 'Hi {name}, your payment has been processed. Please check your account. For questions, contact HR at 011-555-1234.'
        }
    };
    
    // Try to load any custom templates from localStorage
    try {
        const savedTemplates = localStorage.getItem('smsTemplates');
        if (savedTemplates) {
            const customTemplates = JSON.parse(savedTemplates);
            messageTemplates = {...messageTemplates, ...customTemplates};
        }
    } catch (e) {
        console.error('Error loading templates:', e);
    }
    
    // Populate template dropdown
    const templateSelect = $('#messageTemplate');
    templateSelect.find('option:gt(0)').remove(); // Remove all options except the first one
    
    Object.entries(messageTemplates).forEach(([id, template]) => {
        templateSelect.append(`<option value="${id}">${template.name}</option>`);
    });
}

/**
 * Save a new message template with notification
 */
function saveMessageTemplate(name, content) {
    // Generate a unique ID for the template
    const templateId = 'template_' + Date.now();
    
    // Add to messageTemplates object
    messageTemplates[templateId] = {
        name: name,
        content: content
    };
    
    // Add to dropdown
    $('#messageTemplate').append(`<option value="${templateId}">${name}</option>`);
    
    // Save to localStorage for persistence
    try {
        // We only save custom templates, not the predefined ones
        const customTemplates = {};
        Object.entries(messageTemplates).forEach(([id, template]) => {
            if (id.startsWith('template_')) {
                customTemplates[id] = template;
            }
        });
        localStorage.setItem('smsTemplates', JSON.stringify(customTemplates));
        
        // Show notification
        if (notificationSystem) {
            notificationSystem.show({
                type: 'success',
                title: 'Template Saved',
                message: `SMS template "${name}" has been saved successfully`,
                category: 'sms',
                duration: 4000
            });
        }
    } catch (e) {
        console.error('Error saving template:', e);
        if (notificationSystem) {
            notificationSystem.show({
                type: 'error',
                title: 'Save Failed',
                message: 'Failed to save template. Please try again.',
                category: 'sms',
                duration: 5000
            });
        }
    }
    
    showToast('Success', 'Template saved successfully', 'success');
}

/**
 * Load staff data with notification feedback
 */
async function loadStaffData() {
    try {
        // Wait for Supabase client to be ready
        const supabase = await waitForSupabaseClient();
        
        if (!supabase) {
            throw new Error('Supabase client not available - check your database configuration');
        }
        
        console.log('🔧 Supabase client ready, testing connection...');
        
        // First, test the database connection by checking if staff table exists
        const { error: tableError } = await supabase
            .from('makro_staff')
            .select('*', { head: true, count: 'exact' })
            .limit(1);
            
        if (tableError) {
            console.error('❌ Staff table not accessible:', tableError);
            throw new Error(`Staff table error: ${tableError.message}`);
        }
        
        console.log('📊 Staff table is accessible');
        
        // Simple query without complex joins first
        console.log('🔍 Querying staff table...');
        // Query all staff without assuming specific column names like 'active' or 'full_name'
        const { data: staffRecords, error } = await supabase
            .from('makro_staff')
            .select('*');
        
        console.log('📊 Staff query result:', { count: staffRecords?.length, error });
        
        if (error) {
            console.error('❌ Staff query error:', error);
            throw new Error(`Staff query failed: ${error.message}`);
        }
        
        if (!staffRecords || staffRecords.length === 0) {
            console.warn('⚠️ No staff records found in database');
            staffData = [];
            populateStaffDropdown();
            try {
                const statusEl = document.getElementById('staffLoadStatus');
                if (statusEl) statusEl.textContent = '(0 found)';
            } catch(_) {}
            return;
        }
        
        // Transform database records to match our internal format
    staffData = staffRecords.map(staff => {
            
            // Find the best phone number field - try multiple common field names (and dynamic match)
            let phoneNumber = null;
            const configuredFields = (window.RETAIL_CONFIG && Array.isArray(window.RETAIL_CONFIG.PHONE_SEARCH_FIELDS)) ? window.RETAIL_CONFIG.PHONE_SEARCH_FIELDS : [];
            const phoneFields = [
                'phone', 
                'cellphone_number', 
                'cell_phone', 
                'mobile', 
                'mobile_number',
                'cell', 
                'contact_number', 
                'contact', 
                'telephone',
                'tel',
                ...configuredFields
            ];
            // Direct field list pass
            for (const field of phoneFields) {
                if (staff[field] && staff[field].toString().trim() !== '') {
                    phoneNumber = staff[field].toString().trim();
                    break;
                }
            }
            // Fallback: scan any key name containing cell/phone/mobile
            if (!phoneNumber) {
                try {
                    for (const [k, v] of Object.entries(staff)) {
                        if (!v) continue;
                        if (/(cell|mobile|phone|tel|contact)/i.test(k) && v.toString().trim() !== '') {
                            phoneNumber = v.toString().trim();
                            break;
                        }
                    }
                } catch(_) {}
            }
            
            // Try multiple name field combinations
            let staffName = null;
            if (staff.full_name) {
                staffName = staff.full_name;
            } else if (staff.name) {
                staffName = staff.name;
            } else if (staff.first_name && staff.last_name) {
                staffName = `${staff.first_name} ${staff.last_name}`;
            } else if (staff.first_name) {
                staffName = staff.first_name;
            } else if (staff.username) {
                staffName = staff.username;
            } else if (staff.email) {
                staffName = staff.email;
            } else if (staff.staff_code || staff.employee_code) {
                staffName = `Staff ${staff.staff_code || staff.employee_code}`;
            } else {
                staffName = `Staff ID: ${staff.staff_id || staff.id}`;
            }
            
            const transformedStaff = {
                id: staff.staff_id || staff.id || phoneNumber,
                name: staffName,
                cellphone_number: phoneNumber || null,
                site_id: staff.store_code || staff.site_id, // makro_staff uses store_code
                site_name: staff.store_name || staff.site_name || `Site ${staff.store_code}`,
                customer_id: staff.customer_id || 'MAKRO', // Default to MAKRO if not specified
                customer_name: staff.customer_name || 'MAKRO',
                department_id: staff.sub_department || staff.department_id || null,
                // job title mapping
                position_id: staff.job_title_id || staff.position_id || null,
                position_title: staff.first_job_title || staff.job_title || staff.position_title || staff.position || 'Staff Member',
                active: staff.status === 'ACTIVE' || staff.active === true, // Check status field from makro_staff
                email: staff.email_address || staff.contact_email || staff.work_email || staff.email || null,
                hasPhone: !!phoneNumber
            };
            
            return transformedStaff;
            
    });

    // Sort by name for a better UX
    staffData.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        
        // Load staff assignments and enrich staff records (infer customer/site when missing)
        try {
            await loadStaffAssignments();
            applyAssignmentsToStaff();
        } catch (assignErr) {
            console.warn('Assignments enrichment skipped:', assignErr);
        }
        
        console.log(`📊 Final staff data: ${staffData.length} records loaded`);
        
        // If no staff found with phone numbers, show warning
        if (staffData.length === 0) {
            console.warn('No active staff members found with phone numbers');
            
            if (notificationSystem) {
                notificationSystem.show({
                    type: 'warning',
                    title: 'No Staff Phone Numbers',
                    message: 'No active staff members have phone numbers in the database',
                    category: 'sms',
                    duration: 5000
                });
            }
        }
        
        // Populate staff dropdown
        populateStaffDropdown();
        // Update small status next to label
        try {
            const withPhones = staffData.filter(s=> s.active && s.hasPhone).length;
            const statusEl = document.getElementById('staffLoadStatus');
            if (statusEl) statusEl.textContent = `(${staffData.length} total, ${withPhones} with phones)`;
        } catch(_) {}
        
        // Load additional data in parallel
        await Promise.all([
            loadSiteData(),
            loadDepartmentData(),
            loadPositionData()
        ]);
        
        console.log(`✅ Loaded ${staffData.length} staff members from database`);
        
    } catch (error) {
        console.error('Error loading staff data:', error);
        
        if (notificationSystem) {
            notificationSystem.show({
                type: 'error',
                title: 'Failed to Load Staff',
                message: `Database error: ${error.message}. Please check your staff table.`,
                category: 'sms',
                duration: 8000
            });
        }
        
        // NO FALLBACK DATA - Force real database usage only
        console.error('� No fallback data - must fix database connection to load staff');
        staffData = [];
        
        // Still initialize dropdowns (empty)
        populateStaffDropdown();
        await loadSiteData();
        await loadDepartmentData();
        await loadPositionData();
    }
}

/**
 * Load site data from database
 */
async function loadSiteData() {
    try {
        const supabase = await waitForSupabaseClient();
        
        if (!supabase) {
            console.warn('⚠️ Supabase client not available for sites');
            siteData = [];
            populateSiteDropdown();
            return;
        }
        
        console.log('🏢 Loading sites from database...');
        const { data: siteRecords, error } = await supabase
            .from('customer_sites')
            .select('*');
        
        console.log('🏢 Site query result:', { count: siteRecords?.length, error });
        
        if (error) {
            console.warn('❌ Error loading sites:', error);
            siteData = [];
        } else if (siteRecords && siteRecords.length > 0) {
            siteData = siteRecords.map(site => ({
                id: site.site_id,
                name: site.site_name,
                customer_id: site.customer_id
            }));
            // Sort by name if available
            siteData.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        } else {
            console.log('📭 No sites found in database');
            siteData = [];
        }
        
        populateSiteDropdown();
        
    } catch (error) {
        console.warn('❌ Error loading site data:', error);
        siteData = [];
        populateSiteDropdown();
    }
}

/**
 * Load customers from database and populate dropdown
 */
async function loadCustomerData() {
    try {
        const supabase = await waitForSupabaseClient();
        if (!supabase) {
            console.warn('⚠️ Supabase client not available for customers');
            customerData = [];
            populateCustomerDropdown();
            return;
        }

        console.log('👥 Loading customers from database...');
        const { data: customerRecords, error } = await supabase
            .from('customers')
            .select('*');

        console.log('👥 Customer query result:', { count: customerRecords?.length, error });
        if (error) {
            console.warn('❌ Error loading customers:', error);
            customerData = [];
        } else if (customerRecords && customerRecords.length > 0) {
            customerData = customerRecords.map(c => ({
                id: c.customer_id || c.id,
                name: c.customer_name || c.name || `Customer ${c.customer_id || c.id}`
            })).sort((a,b)=> (a.name||'').localeCompare(b.name||''));
        } else {
            console.log('📭 No customers found in database');
            customerData = [];
        }

        populateCustomerDropdown();
    } catch (error) {
        console.warn('❌ Error loading customer data:', error);
        customerData = [];
        populateCustomerDropdown();
    }
}
/**
 * Load department data from the real departments table
 */
async function loadDepartmentData() {
    try {
        const supabase = await waitForSupabaseClient();
        if (!supabase) throw new Error('Supabase client not available');

        // Query departments table
        const { data: depRecords, error } = await supabase
            .from('departments')
            .select('department_code, department_name, is_active')
            .order('department_name', { ascending: true, nullsFirst: true });

        if (error) throw error;

        const rows = Array.isArray(depRecords) ? depRecords : [];
        departmentData = rows
            .filter(d => d.is_active !== false) // default include when null
            .map(d => ({
                id: d.department_code,
                name: d.department_name || d.department_code || d.location || `Department ${d.department_code}`
            }));

        // If still empty, warn (but no dummy data)
        if (departmentData.length === 0) {
            console.warn('📊 No departments found in departments table');
        }

        populateDepartmentDropdown();
    } catch (error) {
        console.warn('Error loading department data:', error);
        departmentData = [];
        populateDepartmentDropdown();
    }
}

/**
 * Load job title data from job_titles table (active only); fallback to staff-derived
 */
async function loadPositionData() {
    try {
        const supabase = await waitForSupabaseClient();
        if (!supabase) throw new Error('Supabase client not available');

        // Load active job titles; prefer name, fallback to code
        const customerFilter = $('#customerSelect').val();
        let query = supabase
            .from('job_titles')
            .select('job_title_id, name, code, active, customer_id')
            .eq('active', true);

        if (customerFilter && customerFilter !== '') {
            query = query.eq('customer_id', Number(customerFilter));
        }

        const { data: jtRows, error } = await query.order('name', { ascending: true, nullsFirst: true });
        if (error) throw error;

        const rows = Array.isArray(jtRows) ? jtRows : [];
        positionData = rows.map(r => ({
            id: r.job_title_id,
            name: r.name || r.code || `Job Title ${r.job_title_id}`
        }));

        // Fallback to staff-derived if table empty
        if (positionData.length === 0) {
            const positionMap = new Map();
            staffData.forEach(staff => {
                if (staff.position_id) {
                    positionMap.set(staff.position_id, {
                        id: staff.position_id,
                        name: staff.position_title || `Job Title ${staff.position_id}`
                    });
                }
            });
            positionData = Array.from(positionMap.values());
            if (positionData.length === 0) {
                console.warn('📊 No job titles found in job_titles table or staff data');
            }
        }

        populatePositionDropdown();

    } catch (error) {
        console.warn('Error loading job title data:', error);
        positionData = []; // No dummy data
        populatePositionDropdown();
    }
}

/**
 * Update SMS balance from real API
 */
async function updateSMSBalance() {
    if (!smsAPI) {
        console.warn('SMS API not available');
        // Set default balance for display
        smsBalance = 1000;
        $('#smsBalance').text(smsBalance.toLocaleString());
        $('#heroCredits').text(smsBalance.toLocaleString());
        return;
    }
    
    try {
        const balanceData = await smsAPI.getBalance();
        smsBalance = balanceData.balance;
        
        // Update display in sidebar and hero bar
        $('#smsBalance').text(smsBalance.toLocaleString());
        $('#heroCredits').text(smsBalance.toLocaleString());
        
        // Show low balance warnings
        if (smsBalance < 100 && notificationSystem) {
            notificationSystem.show({
                type: 'warning',
                title: 'Low SMS Balance',
                message: `Your SMS balance is running low (${smsBalance} credits remaining). Consider topping up.`,
                category: 'sms',
                action_url: 'https://asmsportal.com/topup',
                action_label: 'Top Up Now',
                duration: 8000
            });
        }
        
        if (smsBalance < 20 && notificationSystem) {
            notificationSystem.show({
                type: 'error',
                title: 'Critical SMS Balance',
                message: `Your SMS balance is critically low (${smsBalance} credits). Top up immediately to continue sending messages.`,
                category: 'sms',
                action_url: 'https://asmsportal.com/topup',
                action_label: 'Top Up Now',
                duration: 10000
            });
        }
        
        console.log('💰 SMS balance updated:', smsBalance);
        
    } catch (error) {
        console.error('Failed to update SMS balance:', error);
        
        // Set fallback balance
        smsBalance = 1000;
        $('#smsBalance').text(smsBalance.toLocaleString());
        
        if (notificationSystem) {
            notificationSystem.show({
                type: 'warning',
                title: 'Balance Check Failed',
                message: 'Unable to retrieve SMS balance. Using cached value.',
                category: 'sms',
                duration: 6000
            });
        }
    }
}

/**
 * Update hero bar statistics
 */
async function updateHeroStats() {
    try {
        // Get today's date range
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        
        // Get supabase client
        const supabase = await (window.waitForSupabaseClient ? window.waitForSupabaseClient() : null);
        
        if (!supabase) {
            $('#heroSentToday').text('0');
            return;
        }
        
        // Count messages sent today
        const { data, error, count } = await supabase
            .from('sms_messages')
            .select('*', { count: 'exact', head: true })
            .gte('sent_at', today.toISOString())
            .lt('sent_at', tomorrow.toISOString());
        
        if (error) {
            console.error('Error fetching today\'s SMS count:', error);
            $('#heroSentToday').text('0');
        } else {
            $('#heroSentToday').text((count || 0).toLocaleString());
            console.log('📊 Messages sent today:', count || 0);
        }
    } catch (error) {
        console.error('Failed to update hero stats:', error);
        $('#heroSentToday').text('0');
    }
}

/**
 * Load filter data (sites, departments, positions)
 */
function loadFilterData() {
    try {
        // Sample data - replace with real database queries when ready
        siteData = [
            { id: 1, name: "Makro Centurion" },
            { id: 2, name: "Makro Cornubia" },
            { id: 3, name: "Makro Montague" }
        ];
        
        departmentData = [
            { id: 1, name: "Cashiers" },
            { id: 2, name: "Floor Staff" },
            { id: 3, name: "Management" }
        ];
        
        positionData = [
            { id: 1, name: "Cashier" },
            { id: 2, name: "Supervisor" },
            { id: 3, name: "Manager" },
            { id: 4, name: "Team Lead" }
        ];
        
        // Populate dropdowns
        populateSiteDropdown();
        populateDepartmentDropdown();
        populatePositionDropdown();
        
    } catch (error) {
        console.error('Error loading filter data:', error);
        
        if (notificationSystem) {
            notificationSystem.show({
                type: 'warning',
                title: 'Filter Data Load Error',
                message: 'Some filter options may not be available',
                category: 'sms',
                duration: 5000
            });
        }
        
        // Initialize with empty arrays
        siteData = [];
        departmentData = [];
        positionData = [];
        
        populateSiteDropdown();
        populateDepartmentDropdown();
        populatePositionDropdown();
    }
}

/**
 * Populate staff dropdown with data
 */
function populateStaffDropdown() {
    const staffSelect = $('#staffSelect');
    staffSelect.empty();
        const selectedCustomerId = $('#customerSelect').val();
        // Only show active staff; include those without phones but mark visually
        const activeStaff = staffData.filter(staff => {
            if (!staff.active) return false;
            // Note: makro_staff doesn't have customer_id field, staff are linked via store_code/store_name
            // Customer filtering is handled at site level, so show all active staff
            return true;
        });
    if (activeStaff.length === 0) {
        // Insert a disabled placeholder option so the UI isn't blank
        staffSelect.append('<option disabled>(No staff found)</option>');
    } else {
        activeStaff.forEach(staff => {
            const displayPhone = staff.cellphone_number ? staff.cellphone_number : 'no phone';
            const label = staff.hasPhone ? `${staff.name} (${displayPhone})` : `${staff.name} — no phone`;
            // Do NOT disable; let users see and even select them, we'll filter on send
            staffSelect.append(`<option value="${staff.id}" data-has-phone="${staff.hasPhone ? '1':'0'}">${label}</option>`);
        });
    }
    
    // Trigger change to update the UI
    staffSelect.trigger('change');
}

/**
 * Populate site dropdown with data
 */
function populateSiteDropdown() {
    const siteSelect = $('#siteSelect');
    siteSelect.empty();
    const selectedCustomerId = $('#customerSelect').val();
    const sites = (selectedCustomerId && selectedCustomerId !== '')
        ? siteData.filter(s => String(s.customer_id) === String(selectedCustomerId))
        : siteData;
    sites.forEach(site => {
        siteSelect.append(`<option value="${site.id}">${site.name}</option>`);
    });
}

/**
 * Populate customer dropdown
 */
function populateCustomerDropdown() {
    const customerSelect = $('#customerSelect');
    customerSelect.empty();
    // Add blank option for "all"
    customerSelect.append('<option value="">All Customers</option>');
    customerData.forEach(c => {
        customerSelect.append(`<option value="${c.id}">${c.name}</option>`);
    });
    customerSelect.trigger('change.select2');
}

/**
 * Populate department dropdown with data
 */
function populateDepartmentDropdown() {
    const departmentSelect = $('#departmentSelect');
    departmentSelect.empty();
    
    departmentData.forEach(dept => {
        departmentSelect.append(`<option value="${dept.id}">${dept.name}</option>`);
    });
}

/**
 * Populate position dropdown with data
 */
function populatePositionDropdown() {
    const positionSelect = $('#positionSelect');
    positionSelect.empty();
    
    positionData.forEach(position => {
        positionSelect.append(`<option value="${position.id}">${position.name}</option>`);
    });
}

/**
 * Update the character count and SMS count display
 */
function updateCharacterCount() {
    const messageText = $('#messageText').val();
    const charCount = messageText.length;
    
    // Calculate SMS count (standard SMS is 160 chars)
    const smsCount = Math.ceil(charCount / 160);
    
    // Update display
    $('#charCount').text(charCount);
    $('#smsCount').text(smsCount);
    
    // Add warning classes for approaching limit
    const charCountElement = $('#charCount');
    charCountElement.removeClass('warning danger');
    
    if (charCount > 140 && charCount <= 160) {
        charCountElement.addClass('warning');
    } else if (charCount > 160) {
        charCountElement.addClass('danger');
    }
    
    // Update summary
    $('#summaryLength').text(charCount);
    $('#summarySmsCount').text(smsCount);
    
    // Update cost
    updateCostEstimate();
}

/**
 * Update the selected count badge
 */
function updateSelectedCount() {
    const selectedIds = $('#staffSelect').val() || [];
    const selectedCount = selectedIds.length;
    const selectedWithPhones = staffData.filter(s => selectedIds.includes(String(s.id)) && s.hasPhone).length;
    const text = selectedCount === selectedWithPhones
        ? `${selectedCount} selected`
        : `${selectedCount} selected (${selectedWithPhones} with phones)`;
    $('#selectedCount').text(text);
}

/**
 * Update recipient count based on selection type
 */
function updateRecipientCount() {
    let count = 0;
    const selectedCustomerId = $('#customerSelect').val();
    const selectedType = $('#recipientType').val();
    
    switch(selectedType) {
        case 'individual':
            count = $('#staffSelect').val() ? $('#staffSelect').val().length : 0;
            break;
            
        case 'site':
            const selectedSiteIds = $('#siteSelect').val();
            if (selectedSiteIds && selectedSiteIds.length > 0) {
                // Count staff in selected sites
                const staffInSites = staffData.filter(staff => {
                    if (!(staff.active && staff.hasPhone)) return false;
                    if (selectedCustomerId && selectedCustomerId !== '') {
                        const matchDirectCust = String(staff.customer_id) === String(selectedCustomerId);
                        const matchAssignedCust = Array.isArray(staff.assigned_customers) && staff.assigned_customers.some(cid => String(cid) === String(selectedCustomerId));
                        if (!(matchDirectCust || matchAssignedCust)) return false;
                    }
                    // Match by direct site_id or any assigned site
                    const matchDirectSite = selectedSiteIds.includes(String(staff.site_id));
                    const matchAssignedSite = Array.isArray(staff.assigned_sites) && staff.assigned_sites.some(sid => selectedSiteIds.includes(String(sid)));
                    return matchDirectSite || matchAssignedSite;
                });
                count = staffInSites.length;
            }
            break;
            
        case 'department':
            const selectedDeptIds = $('#departmentSelect').val();
            if (selectedDeptIds && selectedDeptIds.length > 0) {
                // Count staff in selected departments
                const staffInDepts = staffData.filter(staff => {
                    if (!(staff.active && staff.hasPhone)) return false;
                    if (selectedCustomerId && selectedCustomerId !== '') {
                        const matchDirectCust = String(staff.customer_id) === String(selectedCustomerId);
                        const matchAssignedCust = Array.isArray(staff.assigned_customers) && staff.assigned_customers.some(cid => String(cid) === String(selectedCustomerId));
                        if (!(matchDirectCust || matchAssignedCust)) return false;
                    }
                    return selectedDeptIds.includes(String(staff.department_id));
                });
                count = staffInDepts.length;
            }
            break;
            
        case 'position':
            const selectedPosIds = $('#positionSelect').val();
            if (selectedPosIds && selectedPosIds.length > 0) {
                // Count staff in selected positions
                const staffInPositions = staffData.filter(staff => {
                    if (!(staff.active && staff.hasPhone)) return false;
                    if (selectedCustomerId && selectedCustomerId !== '') {
                        const matchDirectCust = String(staff.customer_id) === String(selectedCustomerId);
                        const matchAssignedCust = Array.isArray(staff.assigned_customers) && staff.assigned_customers.some(cid => String(cid) === String(selectedCustomerId));
                        if (!(matchDirectCust || matchAssignedCust)) return false;
                    }
                    return selectedPosIds.includes(String(staff.position_id));
                });
                count = staffInPositions.length;
            }
            break;
            
        case 'mobile':
            // Count valid mobile numbers
            const mobileText = $('#mobileNumbers').val();
            const validNumbers = extractMobileNumbers(mobileText);
            count = validNumbers.length;
            break;
            
        case 'all':
            // Count all active staff with phones (respect customer filter if set)
            count = staffData.filter(staff => {
                if (!(staff.active && staff.hasPhone)) return false;
                if (selectedCustomerId && selectedCustomerId !== '') {
                    const matchDirectCust = String(staff.customer_id) === String(selectedCustomerId);
                    const matchAssignedCust = Array.isArray(staff.assigned_customers) && staff.assigned_customers.some(cid => String(cid) === String(selectedCustomerId));
                    if (!(matchDirectCust || matchAssignedCust)) return false;
                }
                return true;
            }).length;
            break;
    }
    
    // Update the display
    $('#totalRecipients').text(count);
    
    // Update cost estimate
    updateCostEstimate();
    
    // Store for later use
    selectedRecipients = getSelectedRecipients();
    
    // Update breakdown
    updateRecipientBreakdown();
}

/**
 * Get the list of selected recipients based on current selection
 */
function getSelectedRecipients() {
    let recipients = [];
    const selectedCustomerId = $('#customerSelect').val();
    const selectedType = $('#recipientType').val();
    
    switch(selectedType) {
        case 'individual':
            const selectedIds = $('#staffSelect').val();
            if (selectedIds && selectedIds.length > 0) {
                recipients = staffData.filter(staff => 
                    staff.active && staff.hasPhone && selectedIds.includes(String(staff.id))
                );
            }
            break;
            
        case 'site':
            const selectedSiteIds = $('#siteSelect').val();
            if (selectedSiteIds && selectedSiteIds.length > 0) {
                recipients = staffData.filter(staff => {
                    if (!(staff.active && staff.hasPhone)) return false;
                    if (selectedCustomerId && selectedCustomerId !== '') {
                        const matchDirectCust = String(staff.customer_id) === String(selectedCustomerId);
                        const matchAssignedCust = Array.isArray(staff.assigned_customers) && staff.assigned_customers.some(cid => String(cid) === String(selectedCustomerId));
                        if (!(matchDirectCust || matchAssignedCust)) return false;
                    }
                    const matchDirectSite = selectedSiteIds.includes(String(staff.site_id));
                    const matchAssignedSite = Array.isArray(staff.assigned_sites) && staff.assigned_sites.some(sid => selectedSiteIds.includes(String(sid)));
                    return matchDirectSite || matchAssignedSite;
                });
            }
            break;
            
        case 'department':
            const selectedDeptIds = $('#departmentSelect').val();
            if (selectedDeptIds && selectedDeptIds.length > 0) {
                recipients = staffData.filter(staff => {
                    if (!(staff.active && staff.hasPhone)) return false;
                    if (selectedCustomerId && selectedCustomerId !== '') {
                        const matchDirectCust = String(staff.customer_id) === String(selectedCustomerId);
                        const matchAssignedCust = Array.isArray(staff.assigned_customers) && staff.assigned_customers.some(cid => String(cid) === String(selectedCustomerId));
                        if (!(matchDirectCust || matchAssignedCust)) return false;
                    }
                    return selectedDeptIds.includes(String(staff.department_id));
                });
            }
            break;
            
        case 'position':
            const selectedPosIds = $('#positionSelect').val();
            if (selectedPosIds && selectedPosIds.length > 0) {
                recipients = staffData.filter(staff => {
                    if (!(staff.active && staff.hasPhone)) return false;
                    if (selectedCustomerId && selectedCustomerId !== '') {
                        const matchDirectCust = String(staff.customer_id) === String(selectedCustomerId);
                        const matchAssignedCust = Array.isArray(staff.assigned_customers) && staff.assigned_customers.some(cid => String(cid) === String(selectedCustomerId));
                        if (!(matchDirectCust || matchAssignedCust)) return false;
                    }
                    return selectedPosIds.includes(String(staff.position_id));
                });
            }
            break;
            
        case 'mobile':
            // Convert mobile numbers to recipient-like objects
            const mobileText = $('#mobileNumbers').val();
            const validNumbers = extractMobileNumbers(mobileText);
            recipients = validNumbers.map((number, index) => ({
                id: `mobile_${index}`,
                name: `Mobile: ${number}`,
                cellphone_number: number,
                site_id: null,
                site_name: 'Direct Mobile',
                customer_id: null,
                customer_name: 'Direct Contact',
                department_id: null,
                position_id: null,
                position_title: 'Mobile Contact',
                active: true,
                isMobile: true
            }));
            break;
            
        case 'all':
            recipients = staffData.filter(staff => {
                if (!(staff.active && staff.hasPhone)) return false;
                if (selectedCustomerId && selectedCustomerId !== '') {
                    const matchDirectCust = String(staff.customer_id) === String(selectedCustomerId);
                    const matchAssignedCust = Array.isArray(staff.assigned_customers) && staff.assigned_customers.some(cid => String(cid) === String(selectedCustomerId));
                    if (!(matchDirectCust || matchAssignedCust)) return false;
                }
                return true;
            });
            break;
    }
    
    return recipients;
}

/**
 * Load staff assignments from the database
 * Note: staff_assignments table is optional - if it doesn't exist, staff will use direct customer_id/site_id
 */
async function loadStaffAssignments() {
    try {
        const supabase = await waitForSupabaseClient();
        if (!supabase) throw new Error('Supabase client not available');
        console.log('🔗 Loading staff_assignments...');
        const { data, error } = await supabase
            .from('staff_assignments')
            .select('staff_id, customer_id, site_id');
        if (error) {
            // If table doesn't exist, that's okay - staff will use direct customer_id/site_id
            if (error.message?.includes('does not exist') || error.message?.includes('not found')) {
                console.log('ℹ️ staff_assignments table not found - using direct staff.customer_id/site_id');
                staffAssignments = [];
                return staffAssignments;
            }
            throw error;
        }
        staffAssignments = Array.isArray(data) ? data : [];
        console.log(`🔗 Loaded ${staffAssignments.length} staff assignments`);
        return staffAssignments;
    } catch (e) {
        console.warn('⚠️ Failed to load staff assignments:', e.message || e);
        staffAssignments = [];
        return staffAssignments;
    }
}

/**
 * Enrich staffData with assignment info
 * - Adds assigned_customers: number[] and assigned_sites: number[]
 * - If staff.customer_id/site_id missing, infer from assignments (most recent by array order)
 */
function applyAssignmentsToStaff() {
    if (!Array.isArray(staffData) || staffData.length === 0) return;
    const byStaff = new Map();
    for (const a of staffAssignments || []) {
        if (!a || a.staff_id == null) continue;
        const key = String(a.staff_id);
        if (!byStaff.has(key)) byStaff.set(key, []);
        byStaff.get(key).push(a);
    }
    staffData = staffData.map(s => {
        const keyCandidates = [String(s.id), String(s.staff_id || '')].filter(Boolean);
        let records = [];
        for (const k of keyCandidates) {
            if (byStaff.has(k)) { records = byStaff.get(k); break; }
        }
        const assignedCustomers = [...new Set(records.map(r => r.customer_id).filter(v => v != null))];
        const assignedSites = [...new Set(records.map(r => r.site_id).filter(v => v != null))];
        const enriched = { ...s, assigned_customers: assignedCustomers, assigned_sites: assignedSites };
        // Infer missing customer/site
        if ((enriched.customer_id == null || enriched.customer_id === '') && assignedCustomers.length > 0) {
            enriched.customer_id = assignedCustomers[0];
        }
        if ((enriched.site_id == null || enriched.site_id === '') && assignedSites.length > 0) {
            enriched.site_id = assignedSites[0];
        }
        return enriched;
    });
}

/**
 * Update the recipient breakdown display
 */
function updateRecipientBreakdown() {
    const breakdown = $('#recipientBreakdown');
    breakdown.empty();
    
    if (selectedRecipients.length === 0) {
        breakdown.html('<p class="small text-muted">Select recipients to see summary</p>');
        return;
    }
    
    // Create site breakdown
    const siteBreakdown = {};
    selectedRecipients.forEach(staff => {
        const siteName = siteData.find(site => site.id === staff.site_id)?.name || 'Unknown Site';
        siteBreakdown[siteName] = (siteBreakdown[siteName] || 0) + 1;
    });
    
    breakdown.append('<p class="mb-1 mt-2"><strong>By Site:</strong></p>');
    
    Object.entries(siteBreakdown).forEach(([site, count]) => {
        breakdown.append(`<div class="small">${site}: ${count}</div>`);
    });
    
    // Create department breakdown
    const deptBreakdown = {};
    selectedRecipients.forEach(staff => {
        const deptName = departmentData.find(dept => String(dept.id) === String(staff.department_id))?.name || 'Unknown Dept';
        deptBreakdown[deptName] = (deptBreakdown[deptName] || 0) + 1;
    });
    
    breakdown.append('<p class="mb-1 mt-2"><strong>By Department:</strong></p>');
    
    Object.entries(deptBreakdown).forEach(([dept, count]) => {
        breakdown.append(`<div class="small">${dept}: ${count}</div>`);
    });
}

/**
 * Update the SMS summary section
 */
function updateSMSSummary() {
    updateRecipientCount();
    updateCharacterCount();
    updateCostEstimate();
}

/**
 * Update the cost estimate
 */
function updateCostEstimate() {
    const recipientCount = parseInt($('#totalRecipients').text(), 10);
    const smsCount = parseInt($('#smsCount').text(), 10);
    const costPerSMS = 0.35; // Rand
    
    // Calculate total cost
    const totalCost = (recipientCount * smsCount * costPerSMS).toFixed(2);
    
    // Update display
    $('#totalCost').text(totalCost);
}

/**
 * Check SMS balance and show notifications for low balance
 */
async function checkSMSBalance() {
    const { BASE_URL } = window.RETAIL_CONFIG.SMS_API;
    
    try {
        // Real API call to check balance
        const response = await fetch(`${BASE_URL}/balance`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${await getAccessToken()}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            smsBalance = data.balance || data.credits || 0;
            console.log(`💳 SMS Balance: ${smsBalance} credits`);
        } else {
            const errorData = await response.json().catch(() => ({ message: 'Balance check failed' }));
            throw new Error(`Balance check failed: ${errorData.message || response.status}`);
        }
    } catch (error) {
        console.error('Error fetching SMS balance:', error);
        
        if (notificationSystem) {
            notificationSystem.show({
                type: 'error',
                title: 'Balance Check Failed',
                message: 'Could not retrieve SMS balance. Please check your connection.',
                category: 'sms',
                duration: 6000
            });
        }
        
        // Don't set a default balance - let user know there's an issue
        smsBalance = 0;
    }
    
    // Update display
    $('#smsBalance').text(smsBalance.toLocaleString());
    
    // Show low balance warning
    if (smsBalance < 100 && notificationSystem) {
        notificationSystem.show({
            type: 'warning',
            title: 'Low SMS Balance',
            message: `Your SMS balance is running low (${smsBalance} credits remaining). Consider topping up.`,
            category: 'sms',
            action_url: 'https://asmsportal.com/topup',
            action_label: 'Top Up Now',
            duration: 8000
        });
    }
    
    // Show critical balance warning
    if (smsBalance < 20 && notificationSystem) {
        notificationSystem.show({
            type: 'error',
            title: 'Critical SMS Balance',
            message: `Your SMS balance is critically low (${smsBalance} credits). Top up immediately to continue sending messages.`,
            category: 'sms',
            action_url: 'https://asmsportal.com/topup',
            action_label: 'Top Up Now',
            duration: 10000
        });
    }
}

/**
 * Load recent SMS from the real API or show empty state
 */
async function loadRecentSMS() {
    const recentSMSList = $('#recentSmsList');
    recentSMSList.html(`
        <li class="list-group-item text-center py-3">
            <div class="spinner-border spinner-border-sm" role="status">
                <span class="visually-hidden">Loading...</span>
            </div>
            <span class="ms-2">Loading recent messages...</span>
        </li>
    `);
    
    if (!smsAPI) {
        recentSMSList.html(`
            <li class="list-group-item text-center text-muted py-4">
                <i class="fas fa-info-circle fa-2x mb-2"></i>
                <p>SMS API initializing...</p>
                <small>Recent messages will appear once connected</small>
            </li>
        `);
        return;
    }
    
    try {
        // Try to get recent SMS history from API
        const historyData = await smsAPI.getHistory({
            limit: 5,
            offset: 0
        });
        
        recentSMSList.empty();
        
        if (!historyData.messages || historyData.messages.length === 0) {
            recentSMSList.html(`
                <li class="list-group-item text-center text-muted py-4">
                    <i class="fas fa-inbox fa-2x mb-2"></i>
                    <p>No recent messages</p>
                    <small>Messages you send will appear here</small>
                </li>
            `);
            return;
        }
        
        // Display recent SMS
        historyData.messages.forEach(sms => {
            const formattedDate = new Date(sms.created_at).toLocaleString();
            const truncatedMessage = sms.message.length > 50 ? sms.message.substring(0, 50) + '...' : sms.message;
            
            let statusBadge = '';
            if (sms.status === 'delivered') {
                statusBadge = '<span class="badge bg-success">Delivered</span>';
            } else if (sms.status === 'pending' || sms.status === 'sent') {
                statusBadge = '<span class="badge bg-warning text-dark">Pending</span>';
            } else if (sms.status === 'failed') {
                statusBadge = '<span class="badge bg-danger">Failed</span>';
            } else {
                statusBadge = `<span class="badge bg-secondary">${sms.status}</span>`;
            }
            
            recentSMSList.append(`
                <li class="list-group-item">
                    <div class="d-flex justify-content-between align-items-center">
                        <div class="me-auto">
                            <div class="fw-bold">${truncatedMessage}</div>
                            <div class="small text-muted">
                                <i class="fas fa-users me-1"></i>${sms.recipient_count || 1} recipients
                                <span class="mx-1">•</span>
                                <i class="far fa-clock me-1"></i><span>${formattedDate}</span>
                                ${sms.reference ? `<span class="mx-1">•</span><span class="text-muted">#${sms.reference}</span>` : ''}
                            </div>
                        </div>
                        ${statusBadge}
                    </div>
                </li>
            `);
        });
        
    } catch (error) {
        console.error('Error loading recent SMS:', error);
        
        recentSMSList.html(`
            <li class="list-group-item text-center text-muted py-4">
                <i class="fas fa-exclamation-triangle fa-2x mb-2 text-warning"></i>
                <p>Unable to load recent messages</p>
                <small>Check your connection and try refreshing</small>
            </li>
        `);
    }
}

/**
 * Show message preview in modal
 */
function showMessagePreview() {
    const previewRecipientsDiv = $('#previewRecipients');
    const previewMessagesDiv = $('#previewMessages');
    
    previewRecipientsDiv.empty();
    previewMessagesDiv.empty();
    
    // Show recipient summary
    const recipientCount = selectedRecipients.length;
    previewRecipientsDiv.append(`<p class="mb-1"><strong>Total Recipients:</strong> ${recipientCount}</p>`);
    
    // Show first 5 recipients
    const previewRecipients = selectedRecipients.slice(0, 5);
    previewRecipients.forEach(recipient => {
        const siteName = siteData.find(site => site.id === recipient.site_id)?.name || 'Unknown Site';
        previewRecipientsDiv.append(`
            <div class="d-flex align-items-center mb-1">
                <i class="fas fa-user me-2 text-primary"></i>
                <div>
                    <strong>${recipient.name}</strong>
                    <div class="small text-muted">${recipient.cellphone_number} • ${siteName}</div>
                </div>
            </div>
        `);
    });
    
    if (recipientCount > 5) {
        previewRecipientsDiv.append(`<p class="mt-2 text-muted">...and ${recipientCount - 5} more recipients</p>`);
    }
    
    // Show personalized sample messages
    const messageTemplate = $('#messageText').val();
    
    for (let i = 0; i < Math.min(3, previewRecipients.length); i++) {
        const recipient = previewRecipients[i];
        const siteName = siteData.find(site => site.id === recipient.site_id)?.name || 'Unknown Site';
        
        // Replace tags in message
        const personalizedMessage = messageTemplate
            .replace(/\{name\}/g, recipient.name)
            .replace(/\{site\}/g, siteName)
            .replace(/\{shift_date\}/g, moment().add(1, 'day').format('DD/MM/YYYY'))
            .replace(/\{shift_time\}/g, '09:00');
        
        previewMessagesDiv.append(`
            <div class="message-preview mb-3">
                <strong>To: ${recipient.name} (${recipient.cellphone_number})</strong>
                <p class="mt-2 mb-0">${personalizedMessage}</p>
            </div>
        `);
    }
    
    // Add information about message and cost
    const charCount = messageTemplate.length;
    const smsCount = Math.ceil(charCount / 160);
    const totalMessages = recipientCount * smsCount;
    const totalCost = (totalMessages * 0.35).toFixed(2);
    
    previewMessagesDiv.append(`
        <div class="mt-3 pt-3 border-top">
            <p class="mb-1"><strong>Message Length:</strong> ${charCount} characters (${smsCount} SMS per recipient)</p>
            <p class="mb-1"><strong>Total Messages:</strong> ${totalMessages}</p>
            <p class="mb-1"><strong>Estimated Cost:</strong> R${totalCost}</p>
        </div>
    `);
    
    // Show the modal
    const modal = new bootstrap.Modal(document.getElementById('previewModal'));
    modal.show();
}

/**
 * Send SMS to selected recipients using real API
 */
async function sendSMS() {
    if (!smsAPI) {
        showToast('Error', 'SMS service not available', 'error');
        return;
    }
    
    // Get message and recipients
    const message = $('#messageText').val();
    const isScheduled = $('#scheduleMessage').is(':checked');
    let scheduledDateTime = null;
    
    if (isScheduled) {
        const scheduleDate = $('#scheduleDate').val();
        const scheduleTime = $('#scheduleTime').val();
        if (scheduleDate && scheduleTime) {
            scheduledDateTime = `${scheduleDate}T${scheduleTime}`;
        }
    }
    
    // Show sending notification
    if (notificationSystem) {
        notificationSystem.show({
            type: 'info',
            title: 'Sending SMS',
            message: `Sending message to ${selectedRecipients.length} recipients...`,
            category: 'sms',
            duration: 3000
        });
    }
    
    // Show spinner
    const sendButton = $('button[type="submit"]');
    const originalText = sendButton.html();
    sendButton.html('<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Sending...');
    sendButton.prop('disabled', true);
    
    try {
        // Check balance first
        const recipientCount = selectedRecipients.length;
        const smsCount = Math.ceil(message.length / 160);
        const totalMessages = recipientCount * smsCount;
        
        if (totalMessages > smsBalance) {
            throw new Error('Insufficient SMS balance. Please top up your account.');
        }
        
        // Send SMS via real API
        const result = await smsAPI.sendSMS(message, selectedRecipients, {
            scheduledFor: scheduledDateTime,
            reference: `Portal_${Date.now()}`
        });
        
        // 🔥 LOG TO DATABASE - Add each sent SMS to sms_logs table
        await logSMSToDatabase(message, selectedRecipients, result, scheduledDateTime);
        
        // Update balance after successful send
        smsBalance -= totalMessages;
        $('#smsBalance').text(smsBalance.toLocaleString());
        $('#heroCredits').text(smsBalance.toLocaleString());
        
        // Update hero stats
        if (typeof updateHeroStats === 'function') {
            await updateHeroStats();
        }
        
        // Show success notifications
        if (notificationSystem) {
            const successMessage = scheduledDateTime ?
                `Message scheduled for ${recipientCount} recipients on ${new Date(scheduledDateTime).toLocaleString()}` :
                `Message successfully sent to ${recipientCount} recipients`;
            
            notificationSystem.show({
                type: 'success',
                title: 'SMS Campaign Complete',
                message: successMessage,
                category: 'sms',
                duration: 6000
            });
            
            // Show individual delivery notifications for first few recipients
            selectedRecipients.slice(0, 3).forEach((recipient, index) => {
                setTimeout(() => {
                    const siteName = siteData.find(site => site.id === recipient.site_id)?.name || 'Unknown Site';
                    notificationSystem.show({
                        type: 'success',
                        title: 'SMS Sent',
                        message: `Message sent to ${recipient.name} at ${siteName}`,
                        category: 'sms',
                        duration: 4000
                    });
                }, index * 500);
            });
        }
        
        // Show success toast
        const successMessage = scheduledDateTime ?
            `Message scheduled for ${recipientCount} recipients` :
            `Message sent to ${recipientCount} recipients`;
        
        showToast('Success', successMessage, 'success');
        
        // Reset form and update UI
        resetForm();
        await loadRecentSMS();
        
        console.log('📱 SMS sent successfully:', result);
        
    } catch (error) {
        console.error('SMS sending failed:', error);
        
        if (notificationSystem) {
            notificationSystem.show({
                type: 'error',
                title: 'SMS Send Failed',
                message: error.message || 'Failed to send SMS. Please try again.',
                category: 'sms',
                duration: 8000
            });
        }
        
        showToast('Error', error.message || 'Failed to send SMS', 'error');
    }
    
    // Restore button
    sendButton.html(originalText);
    sendButton.prop('disabled', false);
}

/**
 * Send SMS via real API - Production only
 */
async function sendSMSViaAPI(message, recipients, scheduledDateTime) {
    const { BASE_URL, SENDER_ID } = window.RETAIL_CONFIG.SMS_API;
    
    // Check if we have sufficient balance first
    await checkSMSBalance();
    
    const recipientCount = recipients.length;
    const smsCount = Math.ceil(message.length / 160);
    const totalMessages = recipientCount * smsCount;
    
    if (totalMessages > smsBalance) {
        throw new Error('Insufficient SMS balance. Please top up your account.');
    }
    
    // Prepare recipients list
    const phoneNumbers = recipients.map(recipient => {
        // Clean and format phone number
        let phone = recipient.cellphone_number.replace(/[^0-9]/g, '');
        // Add country code if not present
        if (!phone.startsWith('27') && phone.startsWith('0')) {
            phone = '27' + phone.substring(1);
        }
        return {
            number: phone,
            name: recipient.name
        };
    });
    
    // Prepare API payload
    const payload = {
        sender: SENDER_ID,
        message: message,
        recipients: phoneNumbers,
        scheduled: scheduledDateTime ? new Date(scheduledDateTime).toISOString() : null,
        reference: `SMS_${Date.now()}`
    };
    
    console.log(`📱 Sending SMS to ${recipientCount} recipients via API...`);
    
    try {
        const response = await fetch(`${BASE_URL}/sms/send`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${await getAccessToken()}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        
        const data = await response.json();
        
        if (response.ok) {
            // Update balance
            smsBalance -= totalMessages;
            
            // Log SMS records to database
            await logSMSToDatabase(message, recipients, data.messageId || `SMS_${Date.now()}`, scheduledDateTime);
            
            // Show success notifications
            if (notificationSystem) {
                const successMessage = scheduledDateTime ?
                    `Message scheduled for ${recipientCount} recipients on ${new Date(scheduledDateTime).toLocaleString()}` :
                    `Message successfully sent to ${recipientCount} recipients`;
                
                notificationSystem.show({
                    type: 'success',
                    title: 'SMS Campaign Complete',
                    message: successMessage,
                    category: 'sms',
                    duration: 6000
                });
                
                // Show individual delivery notifications for first few recipients
                recipients.slice(0, 3).forEach((recipient, index) => {
                    setTimeout(() => {
                        const siteName = siteData.find(site => site.id === recipient.site_id)?.name || 'Unknown Site';
                        notificationSystem.show({
                            type: 'success',
                            title: 'SMS Delivered',
                            message: `Message sent to ${recipient.name} at ${siteName}`,
                            category: 'sms',
                            duration: 4000
                        });
                    }, index * 500);
                });
            }
            
            // Show success toast
            const successMessage = scheduledDateTime ?
                `Message scheduled for ${recipientCount} recipients` :
                `Message sent to ${recipientCount} recipients`;
            
            showToast('Success', successMessage, 'success');
            
            // Reset form and update UI
            resetForm();
            loadRecentSMS();
            checkSMSBalance();
            
        } else {
            throw new Error(data.message || `API Error: ${response.status} - ${data.error || 'Unknown error'}`);
        }
        
    } catch (apiError) {
        console.error('API call failed:', apiError);
        throw new Error('Failed to send SMS: ' + apiError.message);
    }
}

/**
 * Legacy sendSMS function for fallback (keeping the old simulation logic)
 */
function sendSMSLegacy() {
    const message = $('#messageText').val();
    const isScheduled = $('#scheduleMessage').is(':checked');
    let scheduledDateTime = null;
    
    if (isScheduled) {
        const scheduleDate = $('#scheduleDate').val();
        const scheduleTime = $('#scheduleTime').val();
        if (scheduleDate && scheduleTime) {
            scheduledDateTime = `${scheduleDate}T${scheduleTime}`;
        }
    }
    
    // Simulate API call with realistic delay
    setTimeout(() => {
        // Check if we have sufficient balance
        const recipientCount = selectedRecipients.length;
        const smsCount = Math.ceil(message.length / 160);
        const totalMessages = recipientCount * smsCount;
        
        if (totalMessages > smsBalance) {
            // Show error notification
            if (notificationSystem) {
                notificationSystem.show({
                    type: 'error',
                    title: 'SMS Send Failed',
                    message: 'Insufficient SMS balance. Please top up your account.',
                    category: 'sms',
                    action_url: 'https://asmsportal.com/topup',
                    action_label: 'Top Up Now',
                    duration: 8000
                });
            }
            
            showToast('Error', 'Insufficient SMS balance. Please top up.', 'error');
            sendButton.html(originalText);
            sendButton.prop('disabled', false);
            return;
        }
        
        // Simulate success/failure (90% success rate)
        const success = Math.random() > 0.1;
        
        if (success) {
            // Deduct from balance
            smsBalance -= totalMessages;
            checkSMSBalance();
            
            // Add to recent SMS
            const newSMS = {
                id: Date.now(),
                recipients: recipientCount,
                message: message,
                timestamp: new Date().toISOString(),
                status: 'delivered',
                scheduled: isScheduled,
                scheduledFor: scheduledDateTime
            };
            
            // Create detailed delivery notifications for each recipient
            selectedRecipients.slice(0, 3).forEach((recipient, index) => {
                setTimeout(() => {
                    if (notificationSystem) {
                        const siteName = siteData.find(site => site.id === recipient.site_id)?.name || 'Unknown Site';
                        notificationSystem.show({
                            type: 'success',
                            title: 'SMS Delivered',
                            message: `Message delivered to ${recipient.name} at ${siteName}`,
                            category: 'sms',
                            duration: 4000
                        });
                    }
                }, index * 500); // Stagger notifications
            });
            
            // Show summary notification
            setTimeout(() => {
                if (notificationSystem) {
                    const successMessage = isScheduled ?
                        `Message scheduled for ${recipientCount} recipients on ${new Date(scheduledDateTime).toLocaleString()}` :
                        `Message successfully delivered to ${recipientCount} recipients`;
                    
                    notificationSystem.show({
                        type: 'success',
                        title: 'SMS Campaign Complete',
                        message: successMessage,
                        category: 'sms',
                        action_url: '#',
                        action_label: 'View Report',
                        duration: 6000
                    });
                }
            }, 2000);
            
            // Reload recent SMS
            loadRecentSMS();
            
            // Show success toast
            const successMessage = isScheduled ?
                `Message scheduled for ${recipientCount} recipients` :
                `Message sent to ${recipientCount} recipients`;
            
            showToast('Success', successMessage, 'success');
            
            // Reset form
            resetForm();
        } else {
            // Simulate failure
            if (notificationSystem) {
                notificationSystem.show({
                    type: 'error',
                    title: 'SMS Send Failed',
                    message: `Failed to send message to ${recipientCount} recipients. Network error.`,
                    category: 'sms',
                    action_url: '#',
                    action_label: 'Retry',
                    duration: 8000
                });
            }
            
            showToast('Error', 'Failed to send SMS. Please try again.', 'error');
        }
        
        // Restore button
        sendButton.html(originalText);
        sendButton.prop('disabled', false);
    }, 2500); // Realistic delay
}

/**
 * Reset the form after sending
 */
function resetForm() {
    // Clear message
    $('#messageText').val('');
    $('#messageTemplate').val('');
    
    // Reset recipient selections
    $('.select2').val(null).trigger('change');
    
    // Reset scheduled options
    $('#scheduleMessage').prop('checked', false);
    $('#scheduleOptions').addClass('d-none');
    
    // Update counters
    updateCharacterCount();
    updateSMSSummary();
}

/**
 * Show a toast notification
 */
function showToast(title, message, type) {
    const toast = $('#smsToast');
    
    // Set title and message
    $('#toastTitle').text(title);
    $('#toastMessage').text(message);
    
    // Set toast color based on type
    toast.removeClass('bg-success bg-danger bg-info');
    
    if (type === 'success') {
        toast.addClass('bg-success text-white');
    } else if (type === 'error') {
        toast.addClass('bg-danger text-white');
    } else {
        toast.addClass('bg-info text-white');
    }
    
    // Show the toast
    const bsToast = new bootstrap.Toast(toast);
    bsToast.show();
}

/**
 * Validate the form before submission
 */
function validateForm() {
    // Check if recipients are selected
    if (selectedRecipients.length === 0) {
        showToast('Error', 'Please select at least one recipient', 'error');
        return false;
    }
    
    // Check if message is entered
    const message = $('#messageText').val();
    if (!message || message.trim() === '') {
        showToast('Error', 'Please enter a message', 'error');
        return false;
    }
    
    // Check scheduled date and time if scheduling is enabled
    if ($('#scheduleMessage').is(':checked')) {
        const scheduleDate = $('#scheduleDate').val();
        const scheduleTime = $('#scheduleTime').val();
        
        if (!scheduleDate || !scheduleTime) {
            showToast('Error', 'Please select date and time for scheduled message', 'error');
            return false;
        }
        
        // Check if scheduled time is in the future
        const scheduledDateTime = new Date(`${scheduleDate}T${scheduleTime}`);
        if (scheduledDateTime <= new Date()) {
            showToast('Error', 'Scheduled time must be in the future', 'error');
            return false;
        }
    }
    
    return true;
}

/**
 * Log sent SMS to database for reporting
 */
async function logSMSToDatabase(message, recipients, apiResult, scheduledDateTime = null) {
    try {
        console.log('📝 Logging SMS to database...');
        
        // Get Supabase client
        const supabase = await waitForSupabaseClient();
        if (!supabase) {
            console.error('❌ Cannot log SMS: Supabase client not available');
            return;
        }
        
        // Get current user info
        const currentUser = window.currentUserEmail || localStorage.getItem('username') || 'unknown';
        const currentUserName = localStorage.getItem('admin_session') ? JSON.parse(localStorage.getItem('admin_session')).username : currentUser;
        
        // Prepare SMS log entries for each recipient
        const smsLogEntries = recipients.map(recipient => ({
            message_text: message,
            recipient_phone: recipient.phone || recipient.cellphone_number,
            recipient_name: recipient.name,
            sender_email: currentUser,
            sender_name: currentUserName,
            status: 'sent',
            delivery_status: 'pending',
            external_message_id: apiResult?.messageId || `portal_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            api_response: apiResult || {},
            cost_per_message: 0.50, // Default cost - adjust as needed
            credits_used: Math.ceil(message.length / 160), // SMS segments
            total_recipients: recipients.length,
            message_type: recipients.length > 1 ? 'bulk' : 'individual',
            sent_at: scheduledDateTime ? null : new Date().toISOString(),
            created_at: new Date().toISOString(),
            user_agent: navigator.userAgent,
            campaign_id: `portal_${new Date().toISOString().split('T')[0]}`
        }));
        
        // Insert all SMS log entries
        const { data, error } = await supabase
            .from('sms_logs')
            .insert(smsLogEntries);
            
        if (error) {
            console.error('❌ Error logging SMS to database:', error);
            console.error('Failed entries:', smsLogEntries);
        } else {
            console.log(`✅ Successfully logged ${smsLogEntries.length} SMS messages to database`);
        }
        
    } catch (error) {
        console.error('❌ Exception in logSMSToDatabase:', error);
    }
}

/**
 * ============================================================================
 * CONTACTS MANAGEMENT FUNCTIONALITY
 * ============================================================================
 */

// Global contacts data
let contactsData = [];
let currentEditingContact = null;

/**
 * Initialize contacts functionality
 */
function initializeContacts() {
    console.log('📞 Initializing contacts management...');
    
    // Load contacts when contacts tab is clicked
    document.getElementById('contacts-tab').addEventListener('click', loadContacts);
    
    // Add contact button
    document.getElementById('addContactBtn').addEventListener('click', showContactModal);
    
    // Save contact button
    document.getElementById('saveContactBtn').addEventListener('click', saveContact);
    
    // Contact search
    document.getElementById('contactSearch').addEventListener('input', filterContacts);
    document.getElementById('contactFilter').addEventListener('change', filterContacts);
    
    // Contact picker for SMS
    document.getElementById('selectFromContactsBtn').addEventListener('click', showContactPicker);
    
    // Contact picker search
    document.getElementById('contactPickerSearch').addEventListener('input', filterContactPicker);
    
    console.log('✅ Contacts management initialized');
}

/**
 * Load contacts from database
 */
async function loadContacts() {
    try {
        console.log('📞 Loading contacts from database...');
        const supabase = await window.waitForSupabaseClient();
        
        const { data, error } = await supabase
            .from('contacts')
            .select('*')
            .order('full_name');
            
        if (error) {
            console.error('❌ Error loading contacts:', error);
            if (notificationSystem) {
                notificationSystem.show({
                    type: 'error',
                    title: 'Error',
                    message: 'Error loading contacts',
                    category: 'contacts'
                });
            }
            return;
        }
        
        contactsData = data || [];
        console.log(`📞 Loaded ${contactsData.length} contacts`);
        renderContactsList();
        
    } catch (error) {
        console.error('❌ Exception loading contacts:', error);
        if (notificationSystem) {
            notificationSystem.show({
                type: 'error',
                title: 'Error',
                message: 'Failed to load contacts',
                category: 'contacts'
            });
        }
    }
}

/**
 * Render contacts list
 */
function renderContactsList() {
    const emptyState = document.getElementById('contactsEmptyState');
    const table = document.getElementById('contactsTable');
    const tbody = document.getElementById('contactsTableBody');
    
    if (contactsData.length === 0) {
        emptyState.classList.remove('d-none');
        table.classList.add('d-none');
        return;
    }
    
    emptyState.classList.add('d-none');
    table.classList.remove('d-none');
    
    tbody.innerHTML = contactsData.map(contact => `
        <tr>
            <td>
                <strong>${escapeHtml(contact.full_name)}</strong>
                ${contact.notes ? `<br><small class="text-muted">${escapeHtml(contact.notes)}</small>` : ''}
            </td>
            <td>${escapeHtml(contact.company_name || '')}</td>
            <td>
                <a href="tel:${contact.mobile_number}" class="text-decoration-none">
                    ${escapeHtml(contact.mobile_number)}
                </a>
            </td>
            <td>
                ${contact.email ? `<a href="mailto:${contact.email}" class="text-decoration-none">${escapeHtml(contact.email)}</a>` : ''}
            </td>
            <td>
                <div class="btn-group btn-group-sm">
                    <button class="btn btn-outline-primary" onclick="editContact(${contact.id})" title="Edit">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn btn-outline-success" onclick="sendSMSToContact(${contact.id})" title="Send SMS">
                        <i class="fas fa-sms"></i>
                    </button>
                    <button class="btn btn-outline-danger" onclick="deleteContact(${contact.id})" title="Delete">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
}

/**
 * Filter contacts based on search and filter criteria
 */
function filterContacts() {
    const searchTerm = document.getElementById('contactSearch').value.toLowerCase();
    const filter = document.getElementById('contactFilter').value;
    
    let filteredContacts = [...contactsData];
    
    // Apply search filter
    if (searchTerm) {
        filteredContacts = filteredContacts.filter(contact =>
            contact.full_name.toLowerCase().includes(searchTerm) ||
            (contact.company_name && contact.company_name.toLowerCase().includes(searchTerm)) ||
            contact.mobile_number.includes(searchTerm) ||
            (contact.email && contact.email.toLowerCase().includes(searchTerm))
        );
    }
    
    // Apply category filter
    if (filter === 'recent') {
        // Show contacts created in last 30 days
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        filteredContacts = filteredContacts.filter(contact =>
            new Date(contact.created_at) > thirtyDaysAgo
        );
    } else if (filter === 'company') {
        filteredContacts = filteredContacts.filter(contact =>
            contact.company_name && contact.company_name.trim()
        );
    }
    
    // Temporarily store filtered data
    const originalData = contactsData;
    contactsData = filteredContacts;
    renderContactsList();
    contactsData = originalData;
}

/**
 * Show contact modal for adding or editing
 */
function showContactModal(contact = null) {
    const modal = new bootstrap.Modal(document.getElementById('contactModal'));
    const title = document.getElementById('contactModalLabel');
    const form = document.getElementById('contactForm');
    
    currentEditingContact = contact;
    
    if (contact) {
        title.innerHTML = '<i class="fas fa-edit me-2"></i>Edit Contact';
        document.getElementById('contactId').value = contact.id;
        document.getElementById('contactFullName').value = contact.full_name;
        document.getElementById('contactCompany').value = contact.company_name || '';
        document.getElementById('contactMobile').value = contact.mobile_number;
        document.getElementById('contactEmail').value = contact.email || '';
        document.getElementById('contactAddress').value = contact.address || '';
        document.getElementById('contactNotes').value = contact.notes || '';
    } else {
        title.innerHTML = '<i class="fas fa-user-plus me-2"></i>Add New Contact';
        form.reset();
        document.getElementById('contactId').value = '';
    }
    
    modal.show();
}

/**
 * Save contact to database
 */
async function saveContact() {
    try {
        const fullName = document.getElementById('contactFullName').value.trim();
        const mobile = document.getElementById('contactMobile').value.trim();
        
        if (!fullName || !mobile) {
            showNotification('Full name and mobile number are required', 'error');
            return;
        }
        
        const supabase = await window.waitForSupabaseClient();
        
        const contactData = {
            full_name: fullName,
            company_name: document.getElementById('contactCompany').value.trim() || null,
            mobile_number: normalizePhoneNumber(mobile),
            email: document.getElementById('contactEmail').value.trim() || null,
            address: document.getElementById('contactAddress').value.trim() || null,
            notes: document.getElementById('contactNotes').value.trim() || null
        };
        
        const contactId = document.getElementById('contactId').value;
        const isEditing = contactId && contactId !== '' && contactId !== 'undefined';
        
        let result;
        if (isEditing) {
            // Update existing contact
            result = await supabase
                .from('contacts')
                .update(contactData)
                .eq('id', parseInt(contactId));
        } else {
            // Create new contact
            result = await supabase
                .from('contacts')
                .insert([contactData]);
        }
        
        if (result.error) {
            if (result.error.code === '23505') { // Unique constraint violation
                if (notificationSystem) {
                    notificationSystem.show({
                        type: 'error',
                        title: 'Duplicate Contact',
                        message: 'This mobile number is already saved in your contacts',
                        category: 'contacts'
                    });
                } else {
                    alert('This mobile number is already saved in your contacts');
                }
            } else {
                console.error('❌ Error saving contact:', result.error);
                if (notificationSystem) {
                    notificationSystem.show({
                        type: 'error',
                        title: 'Error',
                        message: 'Error saving contact',
                        category: 'contacts'
                    });
                } else {
                    alert('Error saving contact');
                }
            }
            return;
        }
        
        if (notificationSystem) {
            notificationSystem.show({
                type: 'success',
                title: 'Success',
                message: isEditing ? 'Contact updated successfully' : 'Contact saved successfully',
                category: 'contacts'
            });
        } else {
            alert(isEditing ? 'Contact updated successfully' : 'Contact saved successfully');
        }
        
        // Close modal and refresh list
        bootstrap.Modal.getInstance(document.getElementById('contactModal')).hide();
        await loadContacts();
        
    } catch (error) {
        console.error('❌ Exception saving contact:', error);
        if (notificationSystem) {
            notificationSystem.show({
                type: 'error',
                title: 'Error',
                message: 'Failed to save contact',
                category: 'contacts'
            });
        } else {
            alert('Failed to save contact');
        }
    }
}

/**
 * Edit contact
 */
async function editContact(contactId) {
    const contact = contactsData.find(c => c.id === contactId);
    if (contact) {
        showContactModal(contact);
    }
}

/**
 * Delete contact
 */
async function deleteContact(contactId) {
    if (!confirm('Are you sure you want to delete this contact?')) {
        return;
    }
    
    try {
        const supabase = await window.waitForSupabaseClient();
        
        const { error } = await supabase
            .from('contacts')
            .delete()
            .eq('id', contactId);
            
        if (error) {
            console.error('❌ Error deleting contact:', error);
            if (notificationSystem) {
                notificationSystem.show({
                    type: 'error',
                    title: 'Error',
                    message: 'Error deleting contact',
                    category: 'contacts'
                });
            } else {
                alert('Error deleting contact');
            }
            return;
        }
        
        if (notificationSystem) {
            notificationSystem.show({
                type: 'success',
                title: 'Success',
                message: 'Contact deleted successfully',
                category: 'contacts'
            });
        } else {
            alert('Contact deleted successfully');
        }
        await loadContacts();
        
    } catch (error) {
        console.error('❌ Exception deleting contact:', error);
        if (notificationSystem) {
            notificationSystem.show({
                type: 'error',
                title: 'Error',
                message: 'Failed to delete contact',
                category: 'contacts'
            });
        } else {
            alert('Failed to delete contact');
        }
    }
}

/**
 * Send SMS to specific contact
 */
function sendSMSToContact(contactId) {
    const contact = contactsData.find(c => c.id === contactId);
    if (contact) {
        // Switch to Send SMS tab
        document.getElementById('send-sms-tab').click();
        
        // Set recipient type to mobile
        document.getElementById('recipientType').value = 'mobile';
        document.getElementById('recipientType').dispatchEvent(new Event('change'));
        
        // Set the mobile number
        document.getElementById('mobileNumbers').value = contact.mobile_number;
        document.getElementById('mobileNumbers').dispatchEvent(new Event('input'));
        
        if (notificationSystem) {
            notificationSystem.show({
                type: 'success',
                title: 'Ready',
                message: `Ready to send SMS to ${contact.full_name}`,
                category: 'sms'
            });
        }
    }
}

/**
 * Show contact picker modal for SMS
 */
async function showContactPicker() {
    // Load contacts if not already loaded
    if (contactsData.length === 0) {
        await loadContacts();
    }
    
    renderContactPicker();
    const modal = new bootstrap.Modal(document.getElementById('contactPickerModal'));
    modal.show();
}

/**
 * Render contact picker list
 */
function renderContactPicker() {
    const list = document.getElementById('contactPickerList');
    
    if (contactsData.length === 0) {
        list.innerHTML = `
            <div class="text-center py-4">
                <i class="fas fa-address-book fa-3x mb-3 text-muted"></i>
                <h6>No Contacts Found</h6>
                <p class="text-muted">Add some contacts first to select them for SMS.</p>
            </div>
        `;
        return;
    }
    
    list.innerHTML = contactsData.map(contact => `
        <button type="button" class="list-group-item list-group-item-action contact-picker-item" data-id="${contact.id}">
            <div class="d-flex justify-content-between align-items-start">
                <div>
                    <h6 class="mb-1">${escapeHtml(contact.full_name)}</h6>
                    <p class="mb-1">${escapeHtml(contact.mobile_number)}</p>
                    ${contact.company_name ? `<small class="text-muted">${escapeHtml(contact.company_name)}</small>` : ''}
                </div>
                <i class="fas fa-plus text-success"></i>
            </div>
        </button>
    `).join('');
    
    // Add click handlers
    list.querySelectorAll('.contact-picker-item').forEach(item => {
        item.addEventListener('click', () => {
            const contactId = parseInt(item.dataset.id);
            selectContactForSMS(contactId);
        });
    });
}

/**
 * Filter contact picker
 */
function filterContactPicker() {
    const searchTerm = document.getElementById('contactPickerSearch').value.toLowerCase();
    
    let filteredContacts = contactsData;
    if (searchTerm) {
        filteredContacts = contactsData.filter(contact =>
            contact.full_name.toLowerCase().includes(searchTerm) ||
            (contact.company_name && contact.company_name.toLowerCase().includes(searchTerm)) ||
            contact.mobile_number.includes(searchTerm)
        );
    }
    
    // Temporarily store filtered data and render
    const originalData = contactsData;
    contactsData = filteredContacts;
    renderContactPicker();
    contactsData = originalData;
}

/**
 * Select contact for SMS
 */
function selectContactForSMS(contactId) {
    const contact = contactsData.find(c => c.id === contactId);
    if (contact) {
        const mobileNumbers = document.getElementById('mobileNumbers');
        const currentNumbers = mobileNumbers.value.trim();
        
        // Add the contact's number if not already present
        if (!currentNumbers.includes(contact.mobile_number)) {
            mobileNumbers.value = currentNumbers ? 
                `${currentNumbers}\n${contact.mobile_number}` : 
                contact.mobile_number;
            mobileNumbers.dispatchEvent(new Event('input'));
        }
        
        // Close the picker modal
        bootstrap.Modal.getInstance(document.getElementById('contactPickerModal')).hide();
        
        if (notificationSystem) {
            notificationSystem.show({
                type: 'success',
                title: 'Contact Added',
                message: `Added ${contact.full_name} to recipients`,
                category: 'sms'
            });
        }
    }
}

/**
 * Normalize phone number format
 */
function normalizePhoneNumber(phone) {
    if (!phone) return '';
    
    // Remove all non-digits
    let cleaned = phone.replace(/\D/g, '');
    
    // Handle South African numbers
    if (cleaned.startsWith('27')) {
        return `+${cleaned}`;
    } else if (cleaned.startsWith('0') && cleaned.length === 10) {
        return `+27${cleaned.substring(1)}`;
    } else if (cleaned.length === 9) {
        return `+27${cleaned}`;
    }
    
    // Return with + prefix if it doesn't have one
    return phone.startsWith('+') ? phone : `+${cleaned}`;
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}