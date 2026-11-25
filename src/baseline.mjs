// The baseline counts the existing problems for each file and message. A count may only fall.
// It never accepts a problem in a strict file.

function groupProblems(problems) {
  const counts = {};
  for (const problem of problems) {
    counts[problem.file] ??= {};
    counts[problem.file][problem.messageId] = (counts[problem.file][problem.messageId] ?? 0) + 1;
  }
  return counts;
}

function strictFiles(problems) {
  return new Set(problems.filter((problem) => problem.strict).map((problem) => problem.file));
}

export function countProblems(problems) {
  const counts = groupProblems(problems);
  const strict = strictFiles(problems);
  const sorted = {};
  for (const file of Object.keys(counts).sort()) if (!strict.has(file)) sorted[file] = counts[file];
  return sorted;
}

export function compareWithBaseline(problems, baseline) {
  const counts = groupProblems(problems);
  const strict = strictFiles(problems);
  const grown = [];
  const stale = [];
  for (const [file, messages] of Object.entries(counts))
    for (const [messageId, count] of Object.entries(messages)) {
      const allowed = strict.has(file) ? 0 : (baseline[file]?.[messageId] ?? 0);
      if (count > allowed) grown.push({ file, messageId, count, allowed });
    }
  for (const [file, messages] of Object.entries(baseline))
    for (const [messageId, allowed] of Object.entries(messages)) {
      const count = counts[file]?.[messageId] ?? 0;
      if (count < allowed) stale.push({ file, messageId, count, allowed });
    }
  return { grown, stale };
}
