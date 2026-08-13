function doPost(e) {
  var requestId = new Date().getTime() + "-" + Math.floor(Math.random() * 1000000);
  var payload = {};

  try {
    payload = parsePayload_(e);
    appendCaptureAudit_(requestId, "RECEIVED", "OK", payload, "Payload parsed.");

    // Honeypot: if this hidden field is filled, silently accept and stop.
    if (payload.website) {
      appendCaptureAudit_(requestId, "HONEYPOT", "SKIPPED", payload, "Honeypot triggered.");
      Logger.log("Honeypot triggered for request " + requestId);
      return corsJsonResponse_({ ok: true, message: "Received." });
    }

    // Determine the form source and route accordingly
    var formSource = payload.formSource || "";
    appendCaptureAudit_(requestId, "ROUTING", "OK", payload, "Form source: " + formSource);

    if (formSource === "magneticLead") {
      // Magnetic Lead path: Send to MailerLite only (no Google Sheets)
      return handleMagneticLead_(requestId, payload);
    } else if (formSource === "contactForm") {
      // Contact Form path: Send emails and log to Google Sheets
      return handleContactForm_(requestId, payload);
    } else {
      throw new Error("Unknown form source: " + formSource);
    }
  } catch (err) {
    var msg = err.message || "Unexpected error.";
    appendCaptureAudit_(requestId, "FAILED", "ERROR", payload, msg);
    appendCaptureError_(requestId, "ROUTING", err, payload);
    Logger.log("Form submission error: " + msg + " (Request ID: " + requestId + ")");
    return corsJsonResponse_({ ok: false, message: msg, requestId: requestId });
  }
}

function handleMagneticLead_(requestId, payload) {
  try {
    appendCaptureAudit_(requestId, "VALIDATE", "START", payload, "Validating magnetic lead payload.");

    // Validate required fields for magnetic lead
    validateMagneticLeadPayload_(payload);
    appendCaptureAudit_(requestId, "VALIDATE", "OK", payload, "Validation passed.");

    // Send to MailerLite (non-fatal - log errors but return success)
    try {
      appendCaptureAudit_(requestId, "MAILERLITE", "START", payload, "Calling MailerLite API.");
      subscribeLeadToMailerLite_(payload, requestId);
      appendCaptureAudit_(requestId, "MAILERLITE", "OK", payload, "MailerLite subscription successful.");
      Logger.log("MailerLite subscription successful for request " + requestId);
    } catch (mlErr) {
      appendCaptureAudit_(requestId, "MAILERLITE", "FAILED", payload, String((mlErr && mlErr.message) || mlErr || "Unknown MailerLite error"));
      appendCaptureError_(requestId, "MAILERLITE", mlErr, payload);
      Logger.log("MailerLite error (non-fatal): " + (mlErr.message || mlErr) + " (Request ID: " + requestId + ")");
    }

    appendCaptureAudit_(requestId, "COMPLETE", "OK", payload, "Magnetic lead processing complete.");
    return corsJsonResponse_({ ok: true, message: "Lead processed.", requestId: requestId });
  } catch (err) {
    var msg = err.message || "Magnetic lead processing error.";
    appendCaptureAudit_(requestId, "FAILED", "ERROR", payload, msg);
    appendCaptureError_(requestId, "MAGNETIC_LEAD", err, payload);
    Logger.log("Magnetic lead error: " + msg + " (Request ID: " + requestId + ")");
    return corsJsonResponse_({ ok: false, message: msg, requestId: requestId });
  }
}

function handleContactForm_(requestId, payload) {
  try {
    appendCaptureAudit_(requestId, "VALIDATE", "START", payload, "Validating contact form payload.");

    // Validate required fields for contact form
    validateContactFormPayload_(payload);
    appendCaptureAudit_(requestId, "VALIDATE", "OK", payload, "Validation passed.");

    // Send emails to all contactEmail_ properties
    var emailsSent = 0;
    var emailErrors = [];

    try {
      appendCaptureAudit_(requestId, "EMAIL", "START", payload, "Sending contact form emails.");
      emailsSent = sendContactFormEmails_(payload, requestId);
      appendCaptureAudit_(requestId, "EMAIL", "OK", payload, "Contact form emails sent: " + emailsSent);
      Logger.log("Contact form emails sent: " + emailsSent + " (Request ID: " + requestId + ")");
    } catch (emailErr) {
      emailErrors.push(emailErr.message || emailErr);
      appendCaptureAudit_(requestId, "EMAIL", "FAILED", payload, String((emailErr && emailErr.message) || emailErr || "Unknown email error"));
      appendCaptureError_(requestId, "EMAIL", emailErr, payload);
      Logger.log("Contact form email error: " + (emailErr.message || emailErr) + " (Request ID: " + requestId + ")");
    }

    // Log to Google Sheets
    try {
      appendCaptureAudit_(requestId, "CONTACT_SHEET", "START", payload, "Appending contact form to sheet.");
      appendContactFormToSheet_(payload);
      appendCaptureAudit_(requestId, "CONTACT_SHEET", "OK", payload, "Contact form logged to sheet.");
      Logger.log("Contact form logged to sheet (Request ID: " + requestId + ")");
    } catch (sheetErr) {
      appendCaptureAudit_(requestId, "CONTACT_SHEET", "FAILED", payload, String((sheetErr && sheetErr.message) || sheetErr || "Unknown sheet error"));
      appendCaptureError_(requestId, "CONTACT_SHEET", sheetErr, payload);
      Logger.log("Sheet logging error: " + (sheetErr.message || sheetErr) + " (Request ID: " + requestId + ")");
      throw sheetErr; // Make sheet logging a hard requirement
    }

    if (emailErrors.length > 0 && emailsSent === 0) {
      throw new Error("Failed to send any notification emails.");
    }

    appendCaptureAudit_(requestId, "COMPLETE", "OK", payload, "Contact form processing complete.");
    return corsJsonResponse_({ 
      ok: true, 
      message: "Contact form submitted successfully.", 
      requestId: requestId,
      emailsSent: emailsSent
    });
  } catch (err) {
    var msg = err.message || "Contact form processing error.";
    appendCaptureAudit_(requestId, "FAILED", "ERROR", payload, msg);
    appendCaptureError_(requestId, "CONTACT_FORM", err, payload);
    Logger.log("Contact form error: " + msg + " (Request ID: " + requestId + ")");
    return corsJsonResponse_({ ok: false, message: msg, requestId: requestId });
  }
}

function doOptions(e) {
  return corsJsonResponse_({ ok: true });
}

function parsePayload_(e) {
  var payload = {};

  try {
    // 1. Primary: Handle the text/plain JSON string from the frontend fetch
    if (e && e.postData && e.postData.contents) {
      payload = JSON.parse(e.postData.contents);
    } 
    // 2. Fallback: Handle standard form submissions (x-www-form-urlencoded)
    else if (e && e.parameter) {
      // e.parameter is already an object, no need to parse
      payload = e.parameter; 
    }
  } catch (jsonErr) {
    Logger.log("Payload Parse Error: " + jsonErr.message);
    payload = {}; 
  }

  // Handle various naming conventions from different frontends
  var phoneNumber = payload.phoneNumber || payload.phone || payload["phone-number"] || payload.parentPhone || "";
  var emailAddress = payload.emailAddress || payload.email || payload["email-address"] || payload.parentEmail || "";

  // Return a clean, standardized object to doPost
  return {
    formSource: String(payload.formSource || "").trim(), // "magneticLead" or "contactForm"
    parentName: String(payload.parentName || payload.name || "").trim(),
    studentName: String(payload.studentName || "").trim(),
    phoneNumber: String(phoneNumber || "").trim(),
    emailAddress: String(emailAddress || "").trim(),
    studentStage: String(payload.studentStage || "").trim(),
    referralSource: String(payload.referralSource || "").trim(),
    message: String(payload.message || "").trim(),
    website: String(payload.website || "").trim(), // Honeypot field
    formLoadedAt: String(payload.formLoadedAt || "").trim(),
    submittedAt: String(payload.submittedAt || new Date().toISOString()).trim(),
    pageUrl: String(payload.pageUrl || "").trim(),
    timeZone: String(payload.timeZone || "").trim()
  };
}

function validateMagneticLeadPayload_(payload) {
  if (!payload.parentName) {
    throw new Error("Parent name is required.");
  }
  if (!payload.emailAddress) {
    throw new Error("Email address is required.");
  }
  if (!payload.studentName) {
    throw new Error("Student name is required.");
  }
  if (!payload.studentStage) {
    throw new Error("Student stage is required.");
  }
}

function validateContactFormPayload_(payload) {
  if (!payload.parentName) {
    throw new Error("Parent name is required.");
  }
  if (!payload.emailAddress) {
    throw new Error("Email address is required.");
  }
}

function subscribeLeadToMailerLite_(payload, requestId) {
  var token = getScriptPropertyOrThrow_("MAILERLITE_API_TOKEN");
  var groupId = PropertiesService.getScriptProperties().getProperty("MAILERLITE_GROUP_ID") || "187403591203423234";
  var endpoint = "https://connect.mailerlite.com/api/subscribers";

  var body = {
    email: payload.emailAddress,
    fields: {
      name: payload.parentName,
      phone: payload.phoneNumber
    },
    groups: [groupId]
  };

  try {
    var response = UrlFetchApp.fetch(endpoint, {
      method: "post",
      contentType: "application/json",
      headers: {
        Authorization: "Bearer " + token,
        Accept: "application/json"
      },
      muteHttpExceptions: true,
      payload: JSON.stringify(body)
    });

    var status = response.getResponseCode();
    var responseText = response.getContentText() || "";

    // Log to MailerLite Logs sheet
    appendMailerLiteLog_({
      requestId: requestId,
      status: status,
      success: status >= 200 && status < 300,
      email: payload.emailAddress,
      parentName: payload.parentName,
      phoneNumber: payload.phoneNumber,
      groupId: groupId,
      responseText: responseText,
      errorMessage: ""
    });

    if (status < 200 || status >= 300) {
      throw new Error("MailerLite subscribe failed (" + status + "): " + responseText);
    }

    Logger.log("MailerLite subscription successful. Request ID: " + requestId + ", Email: " + payload.emailAddress);
  } catch (err) {
    // Log error to MailerLite Logs sheet
    appendMailerLiteLog_({
      requestId: requestId,
      status: "REQUEST_ERROR",
      success: false,
      email: payload.emailAddress,
      parentName: payload.parentName,
      phoneNumber: payload.phoneNumber,
      groupId: groupId,
      responseText: "",
      errorMessage: String((err && err.message) || err || "Unknown MailerLite request error")
    });

    Logger.log("MailerLite request error: " + (err.message || err) + " (Request ID: " + requestId + ")");
    throw err;
  }
}

function sendContactFormEmails_(payload, requestId) {
  var props = PropertiesService.getScriptProperties();
  var allProps = props.getProperties();
  var contactEmails = [];

  // Find all properties that start with "contactEmail_"
  for (var key in allProps) {
    if (key.indexOf("contactEmail_") === 0) {
      var emailValue = allProps[key];
      if (emailValue && emailValue.trim() !== "") {
        contactEmails.push({
          key: key,
          email: emailValue.trim()
        });
      }
    }
  }

  // Sort by the number suffix to maintain order (contactEmail_1, contactEmail_2, etc.)
  contactEmails.sort(function(a, b) {
    var numA = parseInt(a.key.replace("contactEmail_", "")) || 0;
    var numB = parseInt(b.key.replace("contactEmail_", "")) || 0;
    return numA - numB;
  });

  if (contactEmails.length === 0) {
    throw new Error("No contact email recipients found. Please configure contactEmail_1, contactEmail_2, etc. in Script Properties.");
  }

  // Format the email
  var subject = "New Contact Form Submission";
  var body = formatContactFormEmail_(payload);

  // Send email to each recipient
  var sentCount = 0;
  var errors = [];

  for (var i = 0; i < contactEmails.length; i++) {
    var recipientEmail = contactEmails[i].email;

    try {
      appendCaptureAudit_(requestId, "EMAIL_SEND", "START", payload, "Attempting to send email to: " + recipientEmail);

      MailApp.sendEmail({
        to: recipientEmail,
        subject: subject,
        body: body
      });

      sentCount++;
      appendCaptureAudit_(requestId, "EMAIL_SEND", "OK", payload, "Email sent successfully to: " + recipientEmail);
      Logger.log("Contact form email sent to: " + recipientEmail + " (Request ID: " + requestId + ")");
    } catch (emailErr) {
      var errMsg = "Failed to send to " + recipientEmail + ": " + (emailErr.message || emailErr);
      errors.push(errMsg);
      appendCaptureAudit_(requestId, "EMAIL_SEND", "FAILED", payload, errMsg);
      appendCaptureError_(requestId, "EMAIL_SEND_" + recipientEmail, emailErr, payload);
      Logger.log(errMsg + " (Request ID: " + requestId + ")");
    }
  }

  if (sentCount === 0) {
    throw new Error("Failed to send emails to any recipients. Errors: " + errors.join("; "));
  }

  return sentCount;
}

function formatContactFormEmail_(payload) {
  var lines = [
    "New contact form submission received:",
    "",
    "Parent Name: " + payload.parentName,
    "Email Address: " + payload.emailAddress
  ];

  if (payload.studentName) {
    lines.push("Student Name: " + payload.studentName);
  }

  if (payload.phoneNumber) {
    lines.push("Phone Number: " + payload.phoneNumber);
  }

  if (payload.studentStage) {
    lines.push("Student Stage: " + payload.studentStage);
  }

  if (payload.referralSource) {
    lines.push("");
    lines.push("How did you hear about Pass 2 Success:");
    lines.push(payload.referralSource);
  }

  if (payload.message) {
    lines.push("");
    lines.push("Additional Message:");
    lines.push(payload.message);
  }

  lines.push("");

  if (payload.submittedAt) {
    lines.push("Submitted At: " + payload.submittedAt);
  }

  if (payload.timeZone) {
    lines.push("Time Zone: " + payload.timeZone);
  }

  if (payload.pageUrl) {
    lines.push("Page URL: " + payload.pageUrl);
  }

  return lines.join("\n");
}

function appendContactFormToSheet_(payload) {
  var sheetId = getScriptPropertyOrThrow_("CONTACT_FORM_SHEET_ID");
  var sheetName = PropertiesService.getScriptProperties().getProperty("CONTACT_FORM_SHEET_NAME") || "Contact Forms";
  var ss = SpreadsheetApp.openById(sheetId);
  var sheet = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);

  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      "Timestamp",
      "Parent Name",
      "Student Name",
      "Email Address",
      "Phone Number",
      "Student Stage",
      "Referral Source",
      "Additional Message",
      "Submitted At",
      "Time Zone",
      "Page URL"
    ]);
  }

  sheet.appendRow([
    new Date(),
    payload.parentName,
    payload.studentName,
    payload.emailAddress,
    payload.phoneNumber,
    payload.studentStage,
    payload.referralSource,
    payload.message,
    payload.submittedAt,
    payload.timeZone,
    payload.pageUrl
  ]);
}

function appendMailerLiteLog_(entry) {
  try {
    var sheetId = PropertiesService.getScriptProperties().getProperty("MAILERLITE_LOG_SHEET_ID") 
                  || PropertiesService.getScriptProperties().getProperty("CONTACT_FORM_SHEET_ID");

    if (!sheetId) {
      Logger.log("No sheet ID configured for MailerLite logs. Skipping log entry.");
      return;
    }

    var logSheetName = PropertiesService.getScriptProperties().getProperty("MAILERLITE_LOG_SHEET_NAME") || "MailerLite Logs";
    var ss = SpreadsheetApp.openById(sheetId);
    var sheet = ss.getSheetByName(logSheetName) || ss.insertSheet(logSheetName);

    if (sheet.getLastRow() === 0) {
      sheet.appendRow([
        "Timestamp",
        "Request ID",
        "Success",
        "Status",
        "Email",
        "Parent Name",
        "Phone Number",
        "Group ID",
        "Response (truncated)",
        "Error Message"
      ]);
    }

    var responseText = String(entry.responseText || "");
    var errorMessage = String(entry.errorMessage || "");
    var maxLen = 4000;
    if (responseText.length > maxLen) {
      responseText = responseText.substring(0, maxLen) + "... [truncated]";
    }
    if (errorMessage.length > maxLen) {
      errorMessage = errorMessage.substring(0, maxLen) + "... [truncated]";
    }

    sheet.appendRow([
      new Date(),
      entry.requestId || "",
      entry.success ? "TRUE" : "FALSE",
      entry.status || "",
      entry.email || "",
      entry.parentName || "",
      entry.phoneNumber || "",
      entry.groupId || "",
      responseText,
      errorMessage
    ]);

    Logger.log("MailerLite log written. Request ID: " + (entry.requestId || "") + ", Status: " + (entry.status || ""));
  } catch (logErr) {
    Logger.log("MailerLite logging failed: " + String((logErr && logErr.message) || logErr));
  }
}

function appendCaptureError_(requestId, step, err, payload) {
  try {
    var sheetId = PropertiesService.getScriptProperties().getProperty("ERROR_SHEET_ID") 
                  || PropertiesService.getScriptProperties().getProperty("CONTACT_FORM_SHEET_ID");

    if (!sheetId) {
      Logger.log("No sheet ID configured for error logs. Skipping error log entry.");
      return;
    }

    var errorSheetName = PropertiesService.getScriptProperties().getProperty("ERROR_SHEET_NAME") || "Errors";
    var ss = SpreadsheetApp.openById(sheetId);
    var sheet = ss.getSheetByName(errorSheetName) || ss.insertSheet(errorSheetName);

    if (sheet.getLastRow() === 0) {
      sheet.appendRow([
        "Timestamp",
        "Request ID",
        "Step",
        "Message",
        "Stack",
        "Name",
        "Student Name",
        "Email Address",
        "Phone Number",
        "Student Stage",
        "Page URL",
        "Referral Source",
        "Form Message"
      ]);
    }

    var message = String((err && err.message) || err || "Unknown error");
    var stack = String((err && err.stack) || "");
    var maxLen = 4000;
    if (message.length > maxLen) {
      message = message.substring(0, maxLen) + "... [truncated]";
    }
    if (stack.length > maxLen) {
      stack = stack.substring(0, maxLen) + "... [truncated]";
    }

    sheet.appendRow([
      new Date(),
      requestId || "",
      step || "",
      message,
      stack,
      payload && payload.parentName ? payload.parentName : "",
      payload && payload.studentName ? payload.studentName : "",
      payload && payload.emailAddress ? payload.emailAddress : "",
      payload && payload.phoneNumber ? payload.phoneNumber : "",
      payload && payload.studentStage ? payload.studentStage : "",
      payload && payload.pageUrl ? payload.pageUrl : "",
      payload && payload.referralSource ? payload.referralSource : "",
      payload && payload.message ? payload.message : ""
    ]);

    Logger.log("Capture error logged. Request ID: " + requestId + ", Step: " + step + ", Message: " + message);
  } catch (logErr) {
    Logger.log("Capture error logging failed: " + String((logErr && logErr.message) || logErr));
  }
}

function appendCaptureAudit_(requestId, step, status, payload, message) {
  try {
    var sheetId = PropertiesService.getScriptProperties().getProperty("AUDIT_SHEET_ID") 
                  || PropertiesService.getScriptProperties().getProperty("CONTACT_FORM_SHEET_ID");

    if (!sheetId) {
      Logger.log("No sheet ID configured for audit logs. Skipping audit log entry.");
      return;
    }

    var auditSheetName = PropertiesService.getScriptProperties().getProperty("AUDIT_SHEET_NAME") || "Capture Audit";
    var ss = SpreadsheetApp.openById(sheetId);
    var sheet = ss.getSheetByName(auditSheetName) || ss.insertSheet(auditSheetName);

    if (sheet.getLastRow() === 0) {
      sheet.appendRow([
        "Timestamp",
        "Request ID",
        "Step",
        "Status",
        "Message",
        "Name",
        "Student Name",
        "Email Address",
        "Phone Number",
        "Student Stage",
        "Page URL",
        "Form Source"
      ]);
    }

    var text = String(message || "");
    var maxLen = 4000;
    if (text.length > maxLen) {
      text = text.substring(0, maxLen) + "... [truncated]";
    }

    sheet.appendRow([
      new Date(),
      requestId || "",
      step || "",
      status || "",
      text,
      payload && payload.parentName ? payload.parentName : "",
      payload && payload.studentName ? payload.studentName : "",
      payload && payload.emailAddress ? payload.emailAddress : "",
      payload && payload.phoneNumber ? payload.phoneNumber : "",
      payload && payload.studentStage ? payload.studentStage : "",
      payload && payload.pageUrl ? payload.pageUrl : "",
      payload && payload.formSource ? payload.formSource : ""
    ]);

    Logger.log("Capture audit written. Request ID: " + (requestId || "") + ", Step: " + (step || "") + ", Status: " + (status || "") + ", Message: " + text);
  } catch (auditErr) {
    Logger.log("Capture audit logging failed: " + String((auditErr && auditErr.message) || auditErr));
  }
}

function getScriptPropertyOrThrow_(key) {
  var value = PropertiesService.getScriptProperties().getProperty(key);
  if (!value) {
    throw new Error("Missing Script Property: " + key);
  }
  return value;
}

function jsonResponse_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function corsJsonResponse_(obj) {
  var output = ContentService.createTextOutput(JSON.stringify(obj));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}

/**
 * Force authentication prompt for external requests
 * Uncomment and run this function once to authorize the script
 */
function forceAuthPrompt() {
  // This simple call forces Google to recognize the script needs external request permissions.
  UrlFetchApp.fetch("https://google.com");
  SpreadsheetApp.getActiveSpreadsheet(); // Force sheet permissions
  MailApp.sendEmail("test@test.com", "Test", "Test"); // Force email permissions (will fail but grants permission)
}
