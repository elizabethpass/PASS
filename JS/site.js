function populateStudentStageYears() {
    const stageSelect = document.getElementById("student-stage");
    if (!stageSelect) {
        return;
    }

    const options = Array.from(stageSelect.options);
    const placeholder = options.find((option) => option.value === "") || new Option("Select one", "");
    const transfer = options.find((option) => option.text.trim().toLowerCase() === "transfer");

    stageSelect.innerHTML = "";
    stageSelect.appendChild(placeholder);

    // Use the upcoming academic year instead of calendar year.
    const now = new Date();
    const schoolYearStartMonthIndex = 7; // August
    const nextSchoolYearStart =
        now.getMonth() >= schoolYearStartMonthIndex ? now.getFullYear() + 1 : now.getFullYear();
    const firstClassYear = nextSchoolYearStart + 1;

    for (let offset = 0; offset < 4; offset += 1) {
        const classYear = firstClassYear + offset;
        const label = `High School Class of ${classYear}`;
        stageSelect.appendChild(new Option(label, label));
    }

    if (transfer) {
        stageSelect.appendChild(transfer);
    }
}

populateStudentStageYears();

(function setupContactFormSubmission() {
    const form = document.getElementById("contact-inquiry-form");
    if (!form) {
        return;
    }

    const statusEl = document.getElementById("contact-form-status");
    const submitButtons = Array.from(form.querySelectorAll("button[type='submit']"));
    const loadedAtInput = document.getElementById("form-loaded-at");
    const endpoint = window.PASS_SITE_CONFIG && window.PASS_SITE_CONFIG.leadsEndpoint;
    const CAL_URL = "https://bookingwithlibbypass.as.me/";

    if (loadedAtInput) {
        loadedAtInput.value = String(Date.now());
    }

    function setStatus(message, isError) {
        if (!statusEl) {
            return;
        }
        statusEl.textContent = message;
        statusEl.style.color = isError ? "#b00020" : "#0f5132";
    }

    function isValidEmail(value) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    }

    function hasMinimumPhoneDigits(value, minimumDigits) {
        const digits = value.replace(/\D/g, "");
        return digits.length >= minimumDigits;
    }

    form.addEventListener("submit", async function onSubmit(event) {
        event.preventDefault();
        const isBookNow = event.submitter && event.submitter.dataset.bookNow === "true";

        if (!endpoint || endpoint.indexOf("REPLACE_WITH_YOUR_DEPLOYMENT_ID") !== -1) {
            setStatus("Set your Google Apps Script endpoint in contact.html before submitting.", true);
            return;
        }

        const formData = new FormData(form);
        const payload = {
            formSource: "contactForm",
            parentName: (formData.get("parent-name") || "").toString().trim(),
            studentName: (formData.get("student-name") || "").toString().trim(),
            phoneNumber: (formData.get("phone-number") || "").toString().trim(),
            emailAddress: (formData.get("email-address") || "").toString().trim(),
            phone: (formData.get("phone-number") || "").toString().trim(),
            email: (formData.get("email-address") || "").toString().trim(),
            message: (formData.get("message") || "").toString().trim(),
            studentStage: (formData.get("student-stage") || "").toString().trim(),
            referralSource: (formData.get("referral-source") || "").toString().trim(),
            website: (formData.get("website") || "").toString().trim(),
            formLoadedAt: (formData.get("form-loaded-at") || "").toString().trim(),
            pageUrl: window.location.href,
            submittedAt: new Date().toISOString(),
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || ""
        };

        if (!payload.parentName || !payload.emailAddress) {
            setStatus("Please complete parent name and email address.", true);
            return;
        }

        if (!isValidEmail(payload.emailAddress)) {
            setStatus("Please enter a valid email address.", true);
            return;
        }

        // Phone is optional for contact form
        if (payload.phoneNumber && !hasMinimumPhoneDigits(payload.phoneNumber, 10)) {
            setStatus("Please enter a valid phone number with at least 10 digits.", true);
            return;
        }

        submitButtons.forEach(function (btn) { btn.disabled = true; });
        setStatus("Submitting...", false);

        try {
            await fetch(endpoint, {
                method: "POST",
                mode: "no-cors",
                headers: {
                    "Content-Type": "text/plain;charset=utf-8"
                },
                body: JSON.stringify(payload)
            });

            form.reset();
            if (loadedAtInput) {
                loadedAtInput.value = String(Date.now());
            }
            populateStudentStageYears();
            setStatus("Thanks! Your message has been sent.", false);

            // If "Book Now" was clicked, open calendar in new tab
            if (isBookNow) {
                window.open(CAL_URL, "_blank", "noopener,noreferrer");
            }
        } catch (error) {
            setStatus("Could not submit right now. Please try again.", true);
            console.error(error);
        } finally {
            submitButtons.forEach(function (btn) { btn.disabled = false; });
        }
    });
})();
