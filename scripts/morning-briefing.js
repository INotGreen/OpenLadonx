#!/usr/bin/osascript -l JavaScript

ObjC.import("Foundation");

function pad(value) {
  return String(value).padStart(2, "0");
}

function formatDate(date) {
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("-");
}

function formatTime(date) {
  return [pad(date.getHours()), pad(date.getMinutes())].join(":");
}

function section(title, lines) {
  return ["## " + title, ""].concat(lines).join("\n");
}

function safeCall(label, fn) {
  try {
    return fn();
  } catch (error) {
    return {
      ok: false,
      lines: ["- " + label + " unavailable: " + String(error)],
    };
  }
}

function eventToLine(event) {
  const start = event.startDate();
  const end = event.endDate();
  const allDay = event.alldayEvent ? event.alldayEvent() : false;
  const title = event.summary ? event.summary() : event.name();
  const location = event.location ? event.location() : "";
  const range = allDay ? "All day" : formatTime(start) + "-" + formatTime(end);
  return "- " + range + "  " + title + (location ? " (" + location + ")" : "");
}

function mailToLine(message) {
  const sender = message.sender ? message.sender() : "Unknown sender";
  const subject = message.subject ? message.subject() : "(No subject)";
  const received = message.dateReceived ? message.dateReceived() : null;
  const when = received instanceof Date ? formatTime(received) : "";
  const flagged = message.flaggedStatus && message.flaggedStatus() ? " [Flagged]" : "";
  return "- " + (when ? "[" + when + "] " : "") + sender + " - " + subject + flagged;
}

function reminderToLine(reminder) {
  const name = reminder.name ? reminder.name() : "(Untitled)";
  const due = reminder.dueDate ? reminder.dueDate() : null;
  const when = due instanceof Date ? formatTime(due) : "No time";
  const listName = reminder.container && reminder.container().name ? reminder.container().name() : "";
  return "- " + when + "  " + name + (listName ? " [" + listName + "]" : "");
}

function getCalendarLines(startOfDay, endOfDay) {
  return safeCall("Calendar", function () {
    const Calendar = Application("Calendar");
    Calendar.includeStandardAdditions = true;
    const calendars = Calendar.calendars();
    const lines = [];

    calendars.forEach(function (calendar) {
      const events = calendar.events();
      events.forEach(function (event) {
        const start = event.startDate();
        if (start instanceof Date && start.getTime() >= startOfDay.getTime() && start.getTime() < endOfDay.getTime()) {
          lines.push({
            sortKey: start.getTime(),
            text: eventToLine(event),
          });
        }
      });
    });

    lines.sort(function (a, b) {
      return a.sortKey - b.sortKey;
    });

    return {
      ok: true,
      lines: lines.length ? lines.map(function (item) { return item.text; }) : ["- No events on your calendar today."],
    };
  });
}

function getMailLines() {
  return safeCall("Mail", function () {
    const Mail = Application("Mail");
    const inboxes = Mail.inbox().mailboxes();
    const messages = [];

    inboxes.forEach(function (mailbox) {
      const unread = mailbox.messages.whose({ readStatus: false })();
      unread.forEach(function (message) {
        const received = message.dateReceived ? message.dateReceived() : null;
        const receivedTime = received instanceof Date ? received.getTime() : 0;
        const flagged = message.flaggedStatus && message.flaggedStatus() ? 1 : 0;
        const score = flagged * 10000000000000 + receivedTime;
        messages.push({
          score: score,
          text: mailToLine(message),
        });
      });
    });

    messages.sort(function (a, b) {
      return b.score - a.score;
    });

    const top = messages.slice(0, 8).map(function (item) { return item.text; });

    return {
      ok: true,
      lines: top.length ? top : ["- No unread inbox mail."],
    };
  });
}

function getReminderLines(tomorrowStart) {
  return safeCall("Reminders", function () {
    const Reminders = Application("Reminders");
    const lists = Reminders.lists();
    const rows = [];

    lists.forEach(function (list) {
      const reminders = list.reminders();
      reminders.forEach(function (reminder) {
        const completed = reminder.completed ? reminder.completed() : false;
        const dueDate = reminder.dueDate ? reminder.dueDate() : null;
        if (!completed && dueDate instanceof Date && dueDate.getTime() < tomorrowStart.getTime()) {
          rows.push({
            sortKey: dueDate.getTime(),
            text: reminderToLine(reminder),
          });
        }
      });
    });

    rows.sort(function (a, b) {
      return a.sortKey - b.sortKey;
    });

    return {
      ok: true,
      lines: rows.length ? rows.map(function (item) { return item.text; }) : ["- No overdue or due-today reminders."],
    };
  });
}

function buildAttentionLines(calendarLines, mailLines, reminderLines) {
  const lines = [];

  if (reminderLines[0] !== "- No overdue or due-today reminders.") {
    lines.push.apply(lines, reminderLines);
  }

  if (calendarLines[0] !== "- No events on your calendar today.") {
    lines.push("- First calendar item: " + calendarLines[0].slice(2));
  }

  const flaggedMail = mailLines.filter(function (line) {
    return line.indexOf("[Flagged]") !== -1;
  });
  if (flaggedMail.length) {
    lines.push.apply(lines, flaggedMail.slice(0, 3).map(function (line) {
      return line.replace("- ", "- Mail: ");
    }));
  } else if (mailLines[0] !== "- No unread inbox mail.") {
    lines.push("- You have unread inbox mail to triage.");
  }

  return lines.length ? lines : ["- Nothing urgent surfaced this morning."];
}

function main() {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const tomorrowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);

  const header = [
    "# Morning Briefing",
    "",
    "- Date: " + formatDate(now),
    "- Generated: " + now.toLocaleString(),
    "",
  ];

  const calendarSection = getCalendarLines(startOfDay, tomorrowStart);
  const mailSection = getMailLines();
  const reminderSection = getReminderLines(tomorrowStart);

  const attentionSectionLines = buildAttentionLines(
    calendarSection.lines,
    mailSection.lines,
    reminderSection.lines,
  );

  const output = []
    .concat(header)
    .concat([section("Calendar", calendarSection.lines), "", section("Important Unread Mail", mailSection.lines), "", section("Needs Attention", attentionSectionLines)])
    .join("\n");

  console.log(output);
}

main();
