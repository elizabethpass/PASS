function doPost(e) {
  var requestId = new Date().getTime() + "-" + Math.floor(Math.random() * 1000000);
  var payload = {};

  try {
    payload = parsePayload_(e);
    appendCaptureAudit_(requestId, "RECEIVED", "OK", payload, "Payload parsed.");

    // Honeypot: if this hidden field is filled, silently accept and stop.
    if (payload.website) {
      appendCaptureAudit_(requestId, "HONEYPOT", "SKIPPED", payload, "Honeypot triggered.");
      return corsJsonResponse_({ ok: true, message: "Received." });
    }

    validatePayload_(payload);
    appendCaptureAudit_(requestId, "VALIDATE", "OK", payload, "Validation passed.");

    try {
      appendCaptureAudit_(requestId, "LEAD_SHEET", "START", payload, "Appending lead row.");
      appendLeadToSheet_(payload);
      appendCaptureAudit_(requestId, "LEAD_SHEET", "OK", payload, "Lead row appended.");
    } catch (sheetErr) {
      appendCaptureAudit_(requestId, "LEAD_SHEET", "FAILED", payload, String((sheetErr && sheetErr.message) || sheetErr || "Unknown sheet error"));
      appendCaptureError_(requestId, "LEAD_SHEET", sheetErr, payload);
    }

    try {
      appendCaptureAudit_(requestId, "EMAIL", "START", payload, "Sending notification email.");
      sendLeadEmail_(payload);
      appendCaptureAudit_(requestId, "EMAIL", "OK", payload, "Email sent.");
    } catch (emailErr) {
      appendCaptureAudit_(requestId, "EMAIL", "FAILED", payload, String((emailErr && emailErr.message) || emailErr || "Unknown email error"));
      appendCaptureError_(requestId, "EMAIL", emailErr, payload);
    }

    // MailerLite is non-fatal: a failure here is logged but does not
    // prevent the user from seeing a success response.
    try {
      appendCaptureAudit_(requestId, "MAILERLITE", "START", payload, "Calling MailerLite API.");
      subscribeLeadToMailerLite_(payload);
      appendCaptureAudit_(requestId, "MAILERLITE", "OK", payload, "MailerLite API completed.");
    } catch (mlErr) {
      appendCaptureAudit_(requestId, "MAILERLITE", "FAILED", payload, String((mlErr && mlErr.message) || mlErr || "Unknown MailerLite error"));
      appendCaptureError_(requestId, "MAILERLITE", mlErr, payload);
      Logger.log("MailerLite non-fatal error: " + (mlErr.message || mlErr));
    }

    appendCaptureAudit_(requestId, "COMPLETE", "OK", payload, "Capture processing finished.");
    return corsJsonResponse_({ ok: true, message: "Lead processed.", requestId: requestId });
  } catch (err) {
    var msg = err.message || "Unexpected error.";
    appendCaptureAudit_(requestId, "FAILED", "ERROR", payload, msg);
    appendCaptureError_(requestId, "VALIDATION_OR_PARSE", err, payload);
    Logger.log("Lead Capture Error: " + msg);
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
    parentName: String(payload.parentName || "").trim(),
    studentName: String(payload.studentName || "").trim(),
    phoneNumber: String(phoneNumber || "").trim(),
    emailAddress: String(emailAddress || "").trim(),
    studentStage: String(payload.studentStage || "").trim(),
    referralSource: String(payload.referralSource || "").trim(),
    website: String(payload.website || "").trim(), // Honeypot field
    formLoadedAt: String(payload.formLoadedAt || "").trim(),
    submittedAt: String(payload.submittedAt || new Date().toISOString()).trim(),
    pageUrl: String(payload.pageUrl || "").trim(),
    timeZone: String(payload.timeZone || "").trim()
  };
}

function validatePayload_(payload) {
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

function subscribeLeadToMailerLite_(payload) {
  var token = getScriptPropertyOrThrow_("MAILERLITE_API_TOKEN");
  var groupId = PropertiesService.getScriptProperties().getProperty("MAILERLITE_GROUP_ID") || "187403591203423234";
  var endpoint = "https://connect.mailerlite.com/api/subscribers";
  var requestId = new Date().getTime() + "-" + Math.floor(Math.random() * 1000000);

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
  } catch (err) {
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

    throw err;
  }
}

function appendMailerLiteLog_(entry) {
  try {
    var sheetId = getScriptPropertyOrThrow_("LEAD_SHEET_ID");
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
    var sheetId = getScriptPropertyOrThrow_("LEAD_SHEET_ID");
    var errorSheetName = PropertiesService.getScriptProperties().getProperty("LEAD_ERROR_SHEET_NAME") || "Errors";
    var ss = SpreadsheetApp.openById(sheetId);
    var sheet = ss.getSheetByName(errorSheetName) || ss.insertSheet(errorSheetName);

    if (sheet.getLastRow() === 0) {
      sheet.appendRow([
        "Timestamp",
        "Request ID",
        "Step",
        "Message",
        "Stack",
        "Parent Name",
        "Student Name",
        "Email Address",
        "Phone Number",
        "Student Stage",
        "Page URL",
        "Referral Source"
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
      payload && payload.referralSource ? payload.referralSource : ""
    ]);

    Logger.log("Capture error logged. Request ID: " + requestId + ", Step: " + step + ", Message: " + message);
  } catch (logErr) {
    Logger.log("Capture error logging failed: " + String((logErr && logErr.message) || logErr));
  }
}

function appendCaptureAudit_(requestId, step, status, payload, message) {
  try {
    var sheetId = getScriptPropertyOrThrow_("LEAD_SHEET_ID");
    var auditSheetName = PropertiesService.getScriptProperties().getProperty("LEAD_AUDIT_SHEET_NAME") || "Capture Audit";
    var ss = SpreadsheetApp.openById(sheetId);
    var sheet = ss.getSheetByName(auditSheetName) || ss.insertSheet(auditSheetName);

    if (sheet.getLastRow() === 0) {
      sheet.appendRow([
        "Timestamp",
        "Request ID",
        "Step",
        "Status",
        "Message",
        "Parent Name",
        "Student Name",
        "Email Address",
        "Phone Number",
        "Student Stage",
        "Page URL"
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
      payload && payload.pageUrl ? payload.pageUrl : ""
    ]);

    Logger.log("Capture audit written. Request ID: " + (requestId || "") + ", Step: " + (step || "") + ", Status: " + (status || "") + ", Message: " + text);
  } catch (auditErr) {
    Logger.log("Capture audit logging failed: " + String((auditErr && auditErr.message) || auditErr));
  }
}

function appendLeadToSheet_(payload) {
  var sheetId = getScriptPropertyOrThrow_("LEAD_SHEET_ID");
  var sheetName = PropertiesService.getScriptProperties().getProperty("LEAD_SHEET_NAME") || "Leads";
  var ss = SpreadsheetApp.openById(sheetId);
  var sheet = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);

  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      "Timestamp",
      "Parent Name",
      "Student Name",
      "Phone Number",
      "Email Address",
      "Student Stage",
      "Referral Source",
      "Submitted At",
      "Time Zone",
      "Page URL"
    ]);
  }

  sheet.appendRow([
    new Date(),
    payload.parentName,
    payload.studentName,
    payload.phoneNumber,
    payload.emailAddress,
    payload.studentStage,
    payload.referralSource,
    payload.submittedAt,
    payload.timeZone,
    payload.pageUrl
  ]);
}

/*
function forceAuthPrompt() {
  // This simple call forces Google to recognize the script needs external request permissions.
  UrlFetchApp.fetch("https://google.com");
}
*/

function sendLeadEmail_(payload) {
  var to = getScriptPropertyOrThrow_("LEAD_RECIPIENT_EMAIL");
  var subject = "Lead Capture";
  var body = [
    "New website lead captured:",
    "",
    "Parent Name: " + payload.parentName,
    "Student Name: " + payload.studentName,
    "Phone Number: " + payload.phoneNumber,
    "Email Address: " + payload.emailAddress,
    "Student Stage: " + payload.studentStage,
    "Referral Source: " + payload.referralSource,
    "Submitted At: " + payload.submittedAt,
    "Time Zone: " + payload.timeZone,
    "Page URL: " + payload.pageUrl
  ].join("\n");

  MailApp.sendEmail({
    to: to,
    subject: subject,
    body: body
  });
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
