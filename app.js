/**
 * WGU D426 Data Management Foundations — Adaptive Study Plan
 * Serverless client-side application backed by independent JSON files and Local Storage.
 */

const STORAGE_KEY = 'wgu_d426_study_plan_v1';

// Chapter difficulty & length weights for distributing weekly sprints
const CHAPTER_WEIGHTS = {
  1: 1.0,
  2: 1.35,
  3: 1.5,
  4: 2.1, // Heaviest theoretical chapter (Conceptual + Logical + Normalization)
  5: 1.4
};

// Weekly hours capacity mapping
const WEEKLY_HOURS_MAP = {
  under10: { hours: 8, capacityFactor: 0.75, label: 'Under 10 hrs/wk' },
  '10to15': { hours: 12.5, capacityFactor: 1.0, label: '10–15 hrs/wk' },
  '15to20': { hours: 17.5, capacityFactor: 1.35, label: '15–20 hrs/wk' },
  '20plus': { hours: 22, capacityFactor: 1.75, label: '20+ hrs/wk' }
};

let allModules = [];
let faqItems = [];
let quotesList = [];

// Default Student State stored in localStorage
let appState = {
  onboarded: false,
  studentName: '',
  startDate: '',
  targetOaDate: '',
  dbExp: 0,
  sqlExp: 0,
  studyStyle: 'steady',   // 'steady', 'accelerating', 'weekend'
  weeklyHours: '10to15',  // 'under10', '10to15', '15to20', '20plus'
  learningPref: 'visual', // 'visual', 'text', 'handson'
  track: 'foundations',   // 'foundations', 'standard', 'fasttrack' (internal only)
  hasTakenPa: false,
  paReport: null,         // Stores Coaching Report scores & flags
  quickPlanActive: false, // Activated on subsequent PA retakes with flags
  completedModules: {},   // { [module_id]: { completedAt, confidence, quizScore } }
  expandedCards: {},      // { [module_id]: boolean } — preserves open/closed state seamlessly
  expandedResources: {},  // { [module_id]: boolean }
  showAllResources: {},   // { [module_id]: boolean }
  currentWeekIndex: 0,
  viewMode: 'sprint',     // 'sprint' or 'full'
  chapterFilter: 'all',
  confidenceFilter: 'all', // 'all', 'todo', 'easy', 'shaky', 'hard'
  showOptional: true,
  dismissedFastTrackDay1: false,
  dismissedPacingAlertDate: null
};

/* ==========================================================================
   Initialization & JSON Fetching
   ========================================================================== */

document.addEventListener('DOMContentLoaded', async () => {
  loadStateFromStorage();
  await loadAllJsonContent();
  setupEventListeners();
  renderDailyQuote();

  if (!appState.onboarded) {
    openOnboardingModal();
  } else {
    ensureNextActiveModuleExpanded();
    initializeDashboard();
  }
});

function loadStateFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      appState = { ...appState, ...parsed };
      if (!appState.expandedCards) appState.expandedCards = {};
      if (!appState.confidenceFilter) appState.confidenceFilter = 'all';
    }
  } catch (err) {
    console.error('Error reading localStorage:', err);
  }
}

function saveStateToStorage() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
  } catch (err) {
    console.error('Error writing localStorage:', err);
  }
}

async function loadAllJsonContent() {
  try {
    const chapterFiles = [
      'chapter1.json',
      'chapter2.json',
      'chapter3.json',
      'chapter4.json',
      'chapter5.json'
    ];

    const chapterPromises = chapterFiles.map(file =>
      fetch(file).then(res => (res.ok ? res.json() : []))
    );

    const [ch1, ch2, ch3, ch4, ch5, faqData, quotesData] = await Promise.all([
      ...chapterPromises,
      fetch('faq.json').then(res => (res.ok ? res.json() : [])),
      fetch('quotes.json').then(res => (res.ok ? res.json() : []))
    ]);

    allModules = [...ch1, ...ch2, ...ch3, ...ch4, ...ch5].sort(
      (a, b) => a.module_id - b.module_id
    );
    faqItems = faqData;
    quotesList = quotesData;
  } catch (err) {
    console.error('Error loading JSON files:', err);
  }
}

/* ==========================================================================
   Onboarding & Invisible Track Calculation (With DB=0 Beginner Guardrail)
   ========================================================================== */

function openOnboardingModal() {
  const modal = document.getElementById('onboardingModal');
  modal.classList.remove('hidden');

  const dateInput = document.getElementById('targetOaDateInput');
  const today = new Date();
  const minDateStr = formatDateISO(today);
  dateInput.min = minDateStr;

  if (appState.targetOaDate) {
    dateInput.value = appState.targetOaDate;
  } else {
    const defaultTarget = new Date();
    defaultTarget.setDate(today.getDate() + 28);
    dateInput.value = formatDateISO(defaultTarget);
  }

  if (appState.studentName) {
    document.getElementById('studentNameInput').value = appState.studentName;
  }
}

/**
 * Someone who says they do not know anything about databases (dbExp === 0)
 * cannot write basic/heavy SQL and must be treated strictly as a beginner.
 */
function calculateInvisibleTrack(dbExp, sqlExp) {
  if (dbExp === 0) {
    return 'foundations';
  }
  if (dbExp === 2 || sqlExp === 2) {
    return 'fasttrack';
  }
  if (dbExp === 0 && sqlExp === 0) {
    return 'foundations';
  }
  return 'standard';
}

function handleOnboardingInputChanges() {
  const dbExpEl = document.querySelector('input[name="dbExp"]:checked');
  const sqlOpt0 = document.querySelector('input[name="sqlExp"][value="0"]');
  const sqlOpt1 = document.querySelector('input[name="sqlExp"][value="1"]');
  const sqlOpt2 = document.querySelector('input[name="sqlExp"][value="2"]');
  const sqlOpt1Card = document.getElementById('sqlOpt1Card');
  const sqlOpt2Card = document.getElementById('sqlOpt2Card');
  const lockNote = document.getElementById('sqlBeginnerLockNote');

  if (dbExpEl && Number(dbExpEl.value) === 0) {
    sqlOpt0.checked = true;
    sqlOpt1.disabled = true;
    sqlOpt2.disabled = true;
    sqlOpt1Card.classList.add('disabled-card');
    sqlOpt2Card.classList.add('disabled-card');
    lockNote.classList.remove('hidden');
  } else {
    sqlOpt1.disabled = false;
    sqlOpt2.disabled = false;
    sqlOpt1Card.classList.remove('disabled-card');
    sqlOpt2Card.classList.remove('disabled-card');
    lockNote.classList.add('hidden');
  }

  // Check short timeline warning for beginners
  const sqlExpEl = document.querySelector('input[name="sqlExp"]:checked');
  const dateInput = document.getElementById('targetOaDateInput');
  const warningEl = document.getElementById('shortTimelineWarning');

  if (!dbExpEl || !dateInput.value) return;

  const isBeginner = Number(dbExpEl.value) === 0 || (Number(dbExpEl.value) === 0 && sqlExpEl && Number(sqlExpEl.value) === 0);
  const daysUntil = getDaysBetween(new Date(), new Date(dateInput.value + 'T00:00:00'));

  if (isBeginner && daysUntil < 21) {
    warningEl.classList.remove('hidden');
  } else {
    warningEl.classList.add('hidden');
  }
}

/* ==========================================================================
   Adaptive Module Status & PA Coaching Report Logic
   ========================================================================== */

function getModuleAdaptiveState(mod) {
  let status = 'required'; // 'required', 'optional', 'critical'
  const pa = appState.paReport;

  if (!pa) {
    return { status, weight: CHAPTER_WEIGHTS[mod.chapter] || 1.0 };
  }

  const isComp1Strong = pa.comp1Score === 'Competent' || pa.comp1Score === 'Exemplary';
  const isComp2Strong = pa.comp2Score === 'Competent' || pa.comp2Score === 'Exemplary';
  const isComp3Strong = pa.comp3Score === 'Competent' || pa.comp3Score === 'Exemplary';

  // Skip/Skim Logic for Chapter 1 (Modules 1-4)
  if (
    mod.chapter === 1 &&
    isComp1Strong &&
    !pa.flagDbMgmt &&
    !pa.flagIntroDb
  ) {
    status = 'optional';
  }

  // Skip/Skim Logic for Chapter 2 & 3 if both Comp 1 & Comp 2 are Competent with no flags
  if (
    (mod.chapter === 2 || mod.chapter === 3) &&
    isComp1Strong &&
    isComp2Strong &&
    !pa.flagIntroDb &&
    !pa.flagComplexQueries
  ) {
    status = 'optional';
  }

  // Skip/Skim Logic for Chapter 4 & 5 if Comp 3 is Competent with no flags
  if (
    (mod.chapter === 4 || mod.chapter === 5) &&
    isComp3Strong &&
    !pa.flagDbDesign &&
    !pa.flagNormalization &&
    !pa.flagIndexes
  ) {
    status = 'optional';
  }

  // Deep Dive / Critical Status based on Suggested Study flags
  if (mod.chapter === 1 && (pa.flagDbMgmt || pa.flagIntroDb)) {
    status = 'critical';
  }
  if ((mod.chapter === 2 || mod.chapter === 3) && (pa.flagComplexQueries || pa.flagIntroDb)) {
    status = 'critical';
  }
  if (mod.chapter === 4) {
    const isConceptual = mod.module_id >= 20 && mod.module_id <= 23;
    const isLogicalNorm = mod.module_id >= 24 && mod.module_id <= 27;
    if ((isConceptual && pa.flagDbDesign) || (isLogicalNorm && pa.flagNormalization) || pa.comp3Score === 'Approaching Competence') {
      status = 'critical';
    }
  }
  if (mod.chapter === 5 && (pa.flagIndexes || pa.comp3Score === 'Approaching Competence')) {
    status = 'critical';
  }

  let weight = CHAPTER_WEIGHTS[mod.chapter] || 1.0;
  if (status === 'optional') weight = 0.25;
  if (status === 'critical') weight *= 1.45;

  return { status, weight };
}

/* ==========================================================================
   Weekly Sprints & Suggested Daily Study Buckets (By Schedule & Weekly Hours)
   ========================================================================== */

function buildWeeklySprints() {
  const start = appState.startDate ? new Date(appState.startDate + 'T00:00:00') : new Date();
  const target = appState.targetOaDate ? new Date(appState.targetOaDate + 'T00:00:00') : new Date();

  const totalCalendarDays = Math.max(1, getDaysBetween(start, target));
  const calendarWeeks = Math.max(1, Math.ceil(totalCalendarDays / 7));

  let queue = allModules.map(mod => {
    const adaptive = getModuleAdaptiveState(mod);
    return { ...mod, adaptiveStatus: adaptive.status, weight: adaptive.weight };
  });

  if (appState.quickPlanActive) {
    const criticalList = queue.filter(m => m.adaptiveStatus === 'critical' || m.is_milestone);
    if (criticalList.length > 0) {
      queue = criticalList;
    }
  }

  // Adjust target weekly capacity based on student's weeklyHours selection
  const hoursConfig = WEEKLY_HOURS_MAP[appState.weeklyHours] || WEEKLY_HOURS_MAP['10to15'];
  const totalWeight = queue.reduce((acc, m) => acc + m.weight, 0);

  // Baseline weight per week for 10-15 hours is ~9.5 weight units; scaled by capacityFactor
  const capacityWeightPerWeek = 9.5 * hoursConfig.capacityFactor;
  const minWeeksForGoal = Math.max(1, Math.ceil(totalWeight / capacityWeightPerWeek));

  // Use the tighter of their target date weeks or their weekly hours capacity weeks
  // so someone dedicating 20+ hours gets larger weekly/daily buckets than someone doing <10 hours
  const numWeeks = Math.max(1, Math.min(calendarWeeks, minWeeksForGoal));
  const weightPerWeek = totalWeight / numWeeks;

  const weeks = [];
  let currentBucket = [];
  let currentWeight = 0;

  queue.forEach((mod, idx) => {
    currentBucket.push(mod);
    currentWeight += mod.weight;

    const remainingWeeks = numWeeks - weeks.length;
    const remainingModules = queue.length - (idx + 1);

    if (
      weeks.length < numWeeks - 1 &&
      (currentWeight >= weightPerWeek || remainingModules === remainingWeeks - 1)
    ) {
      weeks.push(currentBucket);
      currentBucket = [];
      currentWeight = 0;
    }
  });

  if (currentBucket.length > 0 || weeks.length === 0) {
    weeks.push(currentBucket);
  }

  return weeks.map((bucket, idx) => {
    const weekStart = new Date(start);
    weekStart.setDate(start.getDate() + idx * 7);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    if (weekEnd > target && idx === weeks.length - 1) {
      weekEnd.setTime(target.getTime());
    }

    const dailyBuckets = distributeModulesIntoDailyBuckets(bucket, weekStart);

    return {
      weekNumber: idx + 1,
      dateRangeLabel: `${formatDateShort(weekStart)} – ${formatDateShort(weekEnd)}`,
      modules: bucket,
      dailyBuckets
    };
  });
}

/**
 * Distributes a week's modules into suggested daily study buckets based on:
 * - studyStyle: 'steady', 'accelerating', or 'weekend'
 * - weeklyHours: 'under10', '10to15', '15to20', '20plus'
 */
function distributeModulesIntoDailyBuckets(weekModules, weekStartDate) {
  if (!weekModules || weekModules.length === 0) return [];

  const style = appState.studyStyle || 'steady';
  const hoursCfg = WEEKLY_HOURS_MAP[appState.weeklyHours] || WEEKLY_HOURS_MAP['10to15'];

  // Create 7 calendar days for the sprint week
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStartDate);
    d.setDate(weekStartDate.getDate() + i);
    const dayOfWeek = d.getDay(); // 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat

    let dayShare = 1.0;
    let focusNote = 'Daily Study Session';

    if (style === 'weekend') {
      // Weekend Warrior: Heavy on Sat/Sun, medium mid-week boost on Wednesday, light/rest other days
      if (dayOfWeek === 6 || dayOfWeek === 0) {
        dayShare = 3.2;
        focusNote = 'Weekend Deep-Dive Block';
      } else if (dayOfWeek === 3) {
        dayShare = 1.8;
        focusNote = 'Mid-Week Power Session';
      } else if (dayOfWeek === 1 || dayOfWeek === 4) {
        dayShare = 0.6;
        focusNote = 'Light Weekday Check-In';
      } else {
        dayShare = 0; // Rest / buffer day
      }
    } else if (style === 'accelerating') {
      // Accelerating: Heavy daily studying Mon-Fri, lighter weekend review
      if (dayOfWeek >= 1 && dayOfWeek <= 5) {
        dayShare = 2.0;
        focusNote = 'Accelerated Daily Block';
      } else if (dayOfWeek === 6) {
        dayShare = 1.2;
        focusNote = 'Weekend Consolidation';
      } else {
        dayShare = 0;
      }
    } else {
      // Slow and steady: Balanced across Mon-Sat
      if (dayOfWeek >= 1 && dayOfWeek <= 6) {
        dayShare = 1.0;
        focusNote = 'Steady Daily Pace';
      } else {
        dayShare = 0;
      }
    }

    days.push({
      dateObj: d,
      dayOfWeek,
      dayLabel: d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }),
      dayShare,
      focusNote,
      modules: [],
      currentWeight: 0
    });
  }

  let activeDays = days.filter(d => d.dayShare > 0);
  if (activeDays.length === 0) activeDays = [days[0]];

  const totalShare = activeDays.reduce((s, d) => s + d.dayShare, 0);
  const totalWeekWeight = weekModules.reduce((s, m) => s + (m.weight || 1), 0);

  let dayIdx = 0;
  weekModules.forEach((mod) => {
    const modWeight = mod.weight || 1;
    let targetDay = activeDays[dayIdx];
    const targetDayMaxWeight = totalWeekWeight * (targetDay.dayShare / totalShare);

    if (
      targetDay.modules.length > 0 &&
      targetDay.currentWeight >= targetDayMaxWeight &&
      dayIdx < activeDays.length - 1
    ) {
      dayIdx++;
      targetDay = activeDays[dayIdx];
    }

    targetDay.modules.push(mod);
    targetDay.currentWeight += modWeight;
  });

  // Return only days that have assigned modules, along with estimated study hours
  return activeDays
    .filter(d => d.modules.length > 0)
    .map(d => {
      const estHours = Math.max(
        0.5,
        Math.round(((d.currentWeight / Math.max(1, totalWeekWeight)) * hoursCfg.hours) * 2) / 2
      );
      return {
        ...d,
        estHoursLabel: `~${estHours} hr${estHours === 1 ? '' : 's'} (${hoursCfg.label})`
      };
    });
}

/* ==========================================================================
   Smart Resource Filtering & Sorting
   ========================================================================== */

function getSortedAndCuratedResources(mod) {
  const resources = mod.resources || [];
  if (resources.length === 0) return { visible: [], total: 0, hasMore: false };

  const pref = appState.learningPref; // 'visual', 'text', 'handson'

  const matchesPref = (res) => {
    if (pref === 'visual') return res.type === 'video' || res.type === 'cohort';
    if (pref === 'text') return res.type === 'pdf' || res.type === 'document' || res.type === 'reference' || res.type === 'article';
    if (pref === 'handson') return res.type === 'interactive' || res.type === 'quiz';
    return false;
  };

  const preferred = resources.filter(matchesPref);
  const others = resources.filter(r => !matchesPref(r));

  let curated = [];
  if (resources.length <= 4 || appState.showAllResources[mod.module_id]) {
    curated = [...preferred, ...others];
    return { visible: curated, total: resources.length, hasMore: resources.length > 4 };
  }

  const topPref = preferred.slice(0, 2);
  const topOthers = others.slice(0, 4 - topPref.length);
  curated = [...topPref, ...topOthers];

  if (curated.length < 4) {
    const remaining = [...preferred.slice(2), ...others.slice(topOthers.length)];
    curated = [...curated, ...remaining.slice(0, 4 - curated.length)];
  }

  return {
    visible: curated,
    total: resources.length,
    hasMore: resources.length > curated.length
  };
}

/* ==========================================================================
   Dashboard Rendering & Seamless Card State Management
   ========================================================================== */

function getNextActiveModuleId() {
  const nextMod = allModules.find(
    m => !appState.completedModules[m.module_id] && getModuleAdaptiveState(m).status !== 'optional'
  );
  return nextMod ? nextMod.module_id : null;
}

function ensureNextActiveModuleExpanded() {
  const nextId = getNextActiveModuleId();
  if (nextId && appState.expandedCards[nextId] === undefined) {
    appState.expandedCards[nextId] = true;
  }
}

function initializeDashboard() {
  renderHeaderMetrics();
  renderDynamicAlerts();
  renderMainView();
}

function renderDailyQuote() {
  const quoteEl = document.getElementById('dailyQuote');
  if (!quotesList || quotesList.length === 0) return;

  const dayOfYear = Math.floor(
    (new Date() - new Date(new Date().getFullYear(), 0, 0)) / (1000 * 60 * 60 * 24)
  );
  const item = quotesList[dayOfYear % quotesList.length];
  quoteEl.textContent = `"${item.quote}" — ${item.author}`;
}

function renderHeaderMetrics() {
  document.getElementById('studentGreeting').textContent = `Hi, ${appState.studentName || 'Student'}`;
  document.getElementById('startDateDisplay').textContent = appState.startDate
    ? formatDateShort(new Date(appState.startDate + 'T00:00:00'))
    : '--';
  document.getElementById('targetDateDisplay').textContent = appState.targetOaDate
    ? formatDateShort(new Date(appState.targetOaDate + 'T00:00:00'))
    : '--';

  const daysRem = appState.targetOaDate
    ? getDaysBetween(new Date(), new Date(appState.targetOaDate + 'T00:00:00'))
    : 0;
  const daysDisplay = document.getElementById('daysRemainingDisplay');
  daysDisplay.textContent = daysRem >= 0 ? `${daysRem} Days` : 'Past Due';

  const activeQueue = allModules.filter(m => getModuleAdaptiveState(m).status !== 'optional');
  const completedCount = activeQueue.filter(m => appState.completedModules[m.module_id]).length;
  const totalCount = activeQueue.length || 1;
  const pct = Math.min(100, Math.round((completedCount / totalCount) * 100));

  document.getElementById('progressText').textContent =
    `Overall Course Progress: ${completedCount} of ${activeQueue.length} Required Modules Completed (${pct}%)`;
  document.getElementById('progressFill').style.width = `${pct}%`;

  const quickBadge = document.getElementById('quickPlanIndicator');
  if (appState.quickPlanActive) {
    quickBadge.classList.remove('hidden');
  } else {
    quickBadge.classList.add('hidden');
  }
}

function renderDynamicAlerts() {
  const container = document.getElementById('alertsContainer');
  container.innerHTML = '';

  const requiredMods = allModules.filter(m => getModuleAdaptiveState(m).status !== 'optional');
  const allRequiredDone = requiredMods.length > 0 && requiredMods.every(m => appState.completedModules[m.module_id]);
  const allPaCompetent =
    appState.paReport &&
    ['Competent', 'Exemplary'].includes(appState.paReport.comp1Score) &&
    ['Competent', 'Exemplary'].includes(appState.paReport.comp2Score) &&
    ['Competent', 'Exemplary'].includes(appState.paReport.comp3Score) &&
    !appState.paReport.flagDbMgmt &&
    !appState.paReport.flagIntroDb &&
    !appState.paReport.flagComplexQueries &&
    !appState.paReport.flagDbDesign &&
    !appState.paReport.flagNormalization &&
    !appState.paReport.flagIndexes;

  if (allRequiredDone || allPaCompetent) {
    const banner = document.createElement('div');
    banner.className = 'alert-banner alert-success';
    banner.innerHTML = `
      <div class="alert-content">
        <h3>Curriculum Complete — Ready for Final Next Steps!</h3>
        <p>You have completed your personalized study plan across all three competencies. Connect with your assigned Course Instructor or email <strong>d426@wgu.edu</strong> to review your final readiness steps.</p>
      </div>
      <div class="alert-actions">
        <a href="mailto:d426@wgu.edu?subject=D426%20Study%20Plan%20Complete%20-%20Next%20Steps" class="btn btn-primary btn-sm">Email Course Team</a>
      </div>
    `;
    container.appendChild(banner);
  }

  if (appState.track === 'fasttrack' && !appState.hasTakenPa && !appState.dismissedFastTrackDay1) {
    const ftBanner = document.createElement('div');
    ftBanner.className = 'alert-banner';
    ftBanner.innerHTML = `
      <div class="alert-content">
        <h3>Day 1 Recommended Task: Take the Pre-Assessment (PA)</h3>
        <p>Since you bring prior database or SQL experience, start by taking the official D426 Pre-Assessment. Then enter your Coaching Report here to skip mastered sections and focus strictly on your gaps.</p>
      </div>
      <div class="alert-actions">
        <button class="btn btn-primary btn-sm" id="ftInputPaBtn">Input PA Coaching Report</button>
        <button class="btn btn-outline btn-sm" id="ftDismissBtn">Keep Standard Queue</button>
      </div>
    `;
    container.appendChild(ftBanner);
    ftBanner.querySelector('#ftInputPaBtn').addEventListener('click', openPaModal);
    ftBanner.querySelector('#ftDismissBtn').addEventListener('click', () => {
      appState.dismissedFastTrackDay1 = true;
      saveStateToStorage();
      renderDynamicAlerts();
    });
  }

  const ch3Completed = appState.completedModules[18] || appState.completedModules[19];
  if (ch3Completed && !appState.hasTakenPa) {
    const paCheckpoint = document.createElement('div');
    paCheckpoint.className = 'alert-banner';
    paCheckpoint.innerHTML = `
      <div class="alert-content">
        <h3>Milestone Reached: Ready to Try the Pre-Assessment (PA)?</h3>
        <p>You have completed Chapters 1–3! Whenever you feel ready, take the D426 Pre-Assessment (or wait until after Chapter 4/5) and input your Coaching Report to calibrate your final review.</p>
      </div>
      <div class="alert-actions">
        <button class="btn btn-primary btn-sm" id="delayedPaBtn">Enter PA Scores</button>
      </div>
    `;
    container.appendChild(paCheckpoint);
    paCheckpoint.querySelector('#delayedPaBtn').addEventListener('click', openPaModal);
  }

  if (appState.startDate && appState.targetOaDate && !allRequiredDone) {
    const start = new Date(appState.startDate + 'T00:00:00');
    const target = new Date(appState.targetOaDate + 'T00:00:00');
    const today = new Date();
    const totalDays = Math.max(1, getDaysBetween(start, target));
    const elapsedDays = Math.max(0, getDaysBetween(start, today));
    const timeElapsedPct = elapsedDays / totalDays;

    const completedCount = requiredMods.filter(m => appState.completedModules[m.module_id]).length;
    const progressPct = completedCount / Math.max(1, requiredMods.length);

    const isBehindBy7DaysOr25Pct =
      (elapsedDays >= 7 && timeElapsedPct - progressPct >= 0.23) ||
      (totalDays < 20 && timeElapsedPct - progressPct >= 0.25);

    const isWayAhead = progressPct - timeElapsedPct >= 0.35 && completedCount >= 6;

    const todayStr = formatDateISO(today);
    if ((isBehindBy7DaysOr25Pct || isWayAhead) && appState.dismissedPacingAlertDate !== todayStr) {
      const paceBanner = document.createElement('div');
      paceBanner.className = 'alert-banner alert-warning';
      if (isBehindBy7DaysOr25Pct) {
        paceBanner.innerHTML = `
          <div class="alert-content">
            <h3>Pacing Check-In: Want to Recalibrate Your Schedule?</h3>
            <p>Life happens! Your timeline is running a bit ahead of your completed modules. Would you like to push your Target OA Date back or redistribute your remaining modules across your remaining days?</p>
          </div>
          <div class="alert-actions">
            <button class="btn btn-primary btn-sm" id="recalcAdjustDateBtn">Push Target OA Date</button>
            <button class="btn btn-outline btn-sm" id="recalcRebalanceBtn">Recalculate Remaining Workload</button>
          </div>
        `;
      } else {
        paceBanner.innerHTML = `
          <div class="alert-content">
            <h3>You're Ahead of Schedule! 🚀</h3>
            <p>You've completed ${Math.round(progressPct * 100)}% of your study plan ahead of pace. Want to pull your Target OA Date closer?</p>
          </div>
          <div class="alert-actions">
            <button class="btn btn-primary btn-sm" id="recalcAdjustDateBtn">Pull Target OA Date Closer</button>
            <button class="btn btn-outline btn-sm" id="recalcRebalanceBtn">Keep Current Date</button>
          </div>
        `;
      }
      container.appendChild(paceBanner);

      paceBanner.querySelector('#recalcAdjustDateBtn').addEventListener('click', openDateModal);
      paceBanner.querySelector('#recalcRebalanceBtn').addEventListener('click', () => {
        appState.startDate = todayStr;
        appState.dismissedPacingAlertDate = todayStr;
        saveStateToStorage();
        initializeDashboard();
      });
    }
  }

  if (appState.quickPlanActive) {
    const qpBanner = document.createElement('div');
    qpBanner.className = 'alert-banner alert-warning';
    qpBanner.innerHTML = `
      <div class="alert-content">
        <h3>Targeted Quick Plan Active</h3>
        <p>Your queue is currently isolating your flagged "Suggested Study" chapters and milestone quizzes. You can return to the full 32-module queue anytime.</p>
      </div>
      <div class="alert-actions">
        <button class="btn btn-outline btn-sm" id="exitQuickPlanBtn">Resume Full Queue</button>
      </div>
    `;
    container.appendChild(qpBanner);
    qpBanner.querySelector('#exitQuickPlanBtn').addEventListener('click', () => {
      appState.quickPlanActive = false;
      saveStateToStorage();
      initializeDashboard();
    });
  }
}

/* ==========================================================================
   Main View Rendering (Weekly Sprint Mode vs. Full Study Plan Mode)
   ========================================================================== */

function renderMainView() {
  const sprintNavTop = document.getElementById('sprintNavSection');
  const sprintNavBottom = document.getElementById('sprintNavBottomSection');
  const fullFilterBar = document.getElementById('fullPlanFilterBar');
  const viewModeBtn = document.getElementById('viewModeToggleBtn');
  const menuPlanLabel = document.getElementById('menuTogglePlanLabel');

  if (appState.viewMode === 'sprint') {
    sprintNavTop.classList.remove('hidden');
    sprintNavBottom.classList.remove('hidden');
    fullFilterBar.classList.add('hidden');
    viewModeBtn.textContent = 'View Full Study Plan';
    menuPlanLabel.textContent = 'Switch to Full Study Plan View';
    renderSprintQueue();
  } else {
    sprintNavTop.classList.add('hidden');
    sprintNavBottom.classList.add('hidden');
    fullFilterBar.classList.remove('hidden');
    viewModeBtn.textContent = 'View Weekly Sprints';
    menuPlanLabel.textContent = 'Switch to Weekly Sprint View';
    renderFullPlanQueue();
  }
}

function renderSprintQueue() {
  const weeks = buildWeeklySprints();
  if (appState.currentWeekIndex >= weeks.length) {
    appState.currentWeekIndex = Math.max(0, weeks.length - 1);
  }

  const currentWeek = weeks[appState.currentWeekIndex];
  const titleText = `Week ${currentWeek.weekNumber} of ${weeks.length} Sprint`;
  const subText = `${currentWeek.dateRangeLabel} • ${currentWeek.modules.length} Modules Scheduled`;

  document.getElementById('sprintTitle').textContent = titleText;
  document.getElementById('sprintSubtitle').textContent = subText;
  document.getElementById('sprintBottomLabel').textContent = `${titleText} (${currentWeek.dateRangeLabel})`;

  const isFirst = appState.currentWeekIndex === 0;
  const isLast = appState.currentWeekIndex >= weeks.length - 1;

  document.getElementById('prevWeekBtn').disabled = isFirst;
  document.getElementById('nextWeekBtn').disabled = isLast;
  document.getElementById('prevWeekBottomBtn').disabled = isFirst;
  document.getElementById('nextWeekBottomBtn').disabled = isLast;

  const container = document.getElementById('modulesContainer');
  container.innerHTML = '';

  const nextActiveId = getNextActiveModuleId();

  currentWeek.dailyBuckets.forEach(dayBucket => {
    const daySection = document.createElement('div');
    daySection.className = 'daily-bucket-group';

    daySection.innerHTML = `
      <div class="daily-bucket-header">
        <span class="daily-bucket-day">📅 ${escapeHtml(dayBucket.dayLabel)} — ${escapeHtml(dayBucket.focusNote)}</span>
        <span class="daily-bucket-meta">Suggested Load: ${escapeHtml(dayBucket.estHoursLabel)}</span>
      </div>
      <div class="daily-bucket-cards"></div>
    `;

    const cardsWrapper = daySection.querySelector('.daily-bucket-cards');
    dayBucket.modules.forEach(mod => {
      cardsWrapper.appendChild(createModuleCardElement(mod, nextActiveId));
    });

    container.appendChild(daySection);
  });

  attachModuleCardListeners();
}

function renderFullPlanQueue() {
  let list = allModules.map(mod => {
    const adaptive = getModuleAdaptiveState(mod);
    return { ...mod, adaptiveStatus: adaptive.status };
  });

  if (appState.chapterFilter !== 'all') {
    list = list.filter(m => String(m.chapter) === String(appState.chapterFilter));
  }
  if (!appState.showOptional) {
    list = list.filter(m => m.adaptiveStatus !== 'optional');
  }

  // Filter by Confidence / Completion status
  if (appState.confidenceFilter !== 'all') {
    list = list.filter(m => {
      const comp = appState.completedModules[m.module_id];
      if (appState.confidenceFilter === 'todo') {
        return !comp;
      }
      return comp && comp.confidence === appState.confidenceFilter;
    });
  }

  const container = document.getElementById('modulesContainer');
  container.innerHTML = '';

  if (list.length === 0) {
    container.innerHTML = `
      <div class="content-box" style="text-align:center; padding: 28px;">
        <strong>No modules match your current filter selection.</strong>
        <p style="font-size: 0.85rem; color: var(--text-secondary); margin-top: 4px;">Try selecting "All Statuses" or "All Chapters" above.</p>
      </div>
    `;
    return;
  }

  const nextActiveId = getNextActiveModuleId();
  list.forEach(mod => {
    container.appendChild(createModuleCardElement(mod, nextActiveId));
  });

  attachModuleCardListeners();
}

function createModuleCardElement(mod, nextActiveId) {
  const isCompleted = Boolean(appState.completedModules[mod.module_id]);
  const compData = appState.completedModules[mod.module_id] || {};
  const isNextActive = mod.module_id === nextActiveId;
  const adaptiveStatus = mod.adaptiveStatus || getModuleAdaptiveState(mod).status;

  // Determine whether card is expanded: explicit user state takes priority; otherwise expand active module
  const isExpanded =
    appState.expandedCards[mod.module_id] !== undefined
      ? Boolean(appState.expandedCards[mod.module_id])
      : isNextActive;

  const card = document.createElement('article');
  card.className = 'module-card';
  card.id = `moduleCard_${mod.module_id}`;

  if (isNextActive) card.classList.add('active-module');
  if (isExpanded) card.classList.add('expanded');
  if (adaptiveStatus === 'optional') card.classList.add('optional-module');

  // Apply confidence-matched color class when completed
  if (isCompleted) {
    const conf = compData.confidence || 'easy';
    card.classList.add(`completed-${conf}`);
  }

  const sectionTitle = mod.zybooks_sections.map(s => s.section).join(' & ');

  // Status Badges (Matched to Confidence Color)
  let badgesHtml = '';
  if (mod.is_milestone) {
    badgesHtml += `<span class="badge badge-milestone">Competency Milestone</span>`;
  }
  if (adaptiveStatus === 'critical') {
    badgesHtml += `<span class="badge badge-critical">Deep Dive • PA Flagged</span>`;
  } else if (adaptiveStatus === 'optional') {
    badgesHtml += `<span class="badge badge-optional">Optional Review (PA Competent)</span>`;
  }

  if (isCompleted) {
    const conf = compData.confidence || 'easy';
    if (conf === 'easy') {
      badgesHtml += `<span class="badge badge-completed-easy">✓ Completed • Felt Easy</span>`;
    } else if (conf === 'shaky') {
      badgesHtml += `<span class="badge badge-completed-shaky">✓ Completed • A Little Shaky</span>`;
    } else if (conf === 'hard') {
      badgesHtml += `<span class="badge badge-completed-hard">✓ Completed • Hard</span>`;
    }
  }

  // Chapter 4 UI Intervention Banner (Module 20)
  const ch4BannerHtml = mod.has_competency_banner
    ? `
    <div class="competency-explainer-banner">
      <h4>💡 WGU Competency Name Decoder (How Chapters 4 & 5 Map to Your Exam)</h4>
      <div class="competency-explainer-grid">
        <div class="comp-phase-box">
          <strong>Database Design</strong><br/>
          = <em>Conceptual Design Phase</em> (Entities, Relationships, Attributes, Cardinality)
        </div>
        <div class="comp-phase-box">
          <strong>Normalization</strong><br/>
          = <em>Logical Design Phase</em> (Primary/Foreign Keys, 1NF, 2NF, 3NF, BCNF)
        </div>
        <div class="comp-phase-box">
          <strong>Indexes</strong><br/>
          = <em>Physical Design Phase</em> (Chapter 5: Heap/Sorted/Hash Tables & Indexes)
        </div>
      </div>
    </div>
  `
    : '';

  const zybooksHtml = mod.zybooks_sections
    .map(
      sec => `
    <li class="zybooks-item">
      <span>${escapeHtml(sec.section)}</span>
      ${sec.is_core_concept ? '<span class="badge badge-core">Core Concept</span>' : ''}
    </li>
  `
    )
    .join('');

  const topicsHtml = mod.topics.map(t => `<li>${escapeHtml(t)}</li>`).join('');

  const shouldAutoOpenResources =
    appState.track === 'foundations' ||
    adaptiveStatus === 'critical' ||
    mod.is_milestone ||
    Boolean(appState.expandedResources[mod.module_id]) ||
    compData.confidence === 'shaky' ||
    compData.confidence === 'hard';

  const curatedRes = getSortedAndCuratedResources(mod);

  const resourcesItemsHtml = curatedRes.visible
    .map(
      res => `
    <div class="resource-item">
      <div class="resource-item-top">
        <a href="${escapeHtml(res.url)}" target="_blank" rel="noopener noreferrer" class="resource-link">
          ${escapeHtml(res.title)} &nearr;
        </a>
        <span class="resource-type-tag">${escapeHtml(res.type)}</span>
      </div>
      ${
        res.instructions
          ? `<div class="resource-instructions"><strong>Study Tip:</strong> ${escapeHtml(res.instructions)}</div>`
          : ''
      }
    </div>
  `
    )
    .join('');

  const showMoreBtnHtml = curatedRes.hasMore
    ? `
    <button type="button" class="resources-toggle-btn show-all-res-btn" data-mod-id="${mod.module_id}">
      ${
        appState.showAllResources[mod.module_id]
          ? 'Show fewer resources'
          : `Show all ${curatedRes.total} supplemental resources`
      }
    </button>
  `
    : '';

  const extraSupportHtml =
    compData.confidence === 'hard' || compData.confidence === 'shaky'
      ? `
    <div class="extra-support-callout">
      <strong>Tricky module? You don't have to get stuck alone:</strong>
      <p>The next module is unlocked so you can keep moving, or use the links below to reinforce this topic:</p>
      <div class="extra-support-links">
        <a href="https://westerngovernorsuniversity.sharepoint.com/sites/AcademicCoachingCenter/SitePages/Peer-to-Peer-Coaching.aspx" target="_blank" rel="noopener noreferrer">🤝 Book a 1-on-1 Peer Tutor</a>
        <a href="mailto:d426@wgu.edu?subject=Help%20with%20D426%20Module%20${mod.module_id}%20(${encodeURIComponent(sectionTitle)})">✉ Email Course Team (d426@wgu.edu)</a>
      </div>
    </div>
  `
      : '';

  const resourcesSectionHtml =
    curatedRes.total > 0
      ? `
    <div class="resources-section">
      <button type="button" class="resources-toggle-btn toggle-res-drawer-btn" data-mod-id="${mod.module_id}">
        ${
          shouldAutoOpenResources
            ? '▾ Hide Supplemental Resources'
            : `▸ Need Extra Help? View Supplemental Resources (${curatedRes.total})`
        }
      </button>
      <div class="resources-drawer ${shouldAutoOpenResources ? '' : 'hidden'}" id="resDrawer_${mod.module_id}">
        <div class="resources-drawer-header">
          <h4>Supplemental Study Resources (Read Zybooks First!)</h4>
          ${showMoreBtnHtml}
        </div>
        <div class="resources-grid">
          ${resourcesItemsHtml}
        </div>
        ${extraSupportHtml}
      </div>
    </div>
  `
      : extraSupportHtml;

  // 80% Mastery Gate with Positive Encouragement Banner when >= 80%
  const passedMasteryGate = isCompleted && compData.quizScore >= 80;
  const masteryGateHtml = mod.is_mastery_gate
    ? `
    <div class="mastery-gate-box">
      <strong>80% Mastery Checkpoint:</strong> Enter your Zybooks Practice Quiz score (%) to verify readiness before moving forward:
      <div class="mastery-gate-row">
        <input type="number" min="0" max="100" placeholder="e.g., 85" class="score-input" id="quizScoreInput_${mod.module_id}" value="${compData.quizScore !== undefined ? compData.quizScore : ''}" />
        <button type="button" class="btn btn-primary btn-sm verify-score-btn" data-mod-id="${mod.module_id}">
          ${isCompleted ? 'Update Score' : 'Verify Score & Complete Module'}
        </button>
        ${
          isCompleted
            ? `<button type="button" class="btn btn-outline btn-sm uncomplete-btn" data-mod-id="${mod.module_id}">Undo</button>`
            : ''
        }
      </div>
      <div id="masteryWarning_${mod.module_id}" class="mastery-warning hidden">
        <strong>Score Below 80%:</strong> You're getting closer! Review the supplemental resources below or email <strong>d426@wgu.edu</strong> / your assigned Course Instructor so we can help you lock down these concepts before the next chapter.
      </div>
      <div id="masterySuccess_${mod.module_id}" class="mastery-success ${passedMasteryGate ? '' : 'hidden'}">
        <strong>🎉 Awesome job scoring ${compData.quizScore || 80}%!</strong> You are doing great and have mastered this chapter's core concepts. Keep that momentum going into the next module below!
      </div>
    </div>
  `
    : '';

  const completionBarHtml = !mod.is_mastery_gate
    ? `
    <div class="completion-bar">
      <span class="confidence-prompt">
        ${isCompleted ? 'Module Completed! You can update your confidence rating anytime:' : 'Finished the Zybooks reading/labs? Rate your confidence to complete:'}
      </span>
      <div class="confidence-buttons">
        <button type="button" class="btn-conf btn-conf-easy ${compData.confidence === 'easy' ? 'selected' : ''}" data-mod-id="${mod.module_id}" data-conf="easy">
          🟢 Felt Easy / Got It
        </button>
        <button type="button" class="btn-conf btn-conf-shaky ${compData.confidence === 'shaky' ? 'selected' : ''}" data-mod-id="${mod.module_id}" data-conf="shaky">
          🟡 A Little Shaky (Show Extra Resources)
        </button>
        <button type="button" class="btn-conf btn-conf-hard ${compData.confidence === 'hard' ? 'selected' : ''}" data-mod-id="${mod.module_id}" data-conf="hard">
          🔴 Hard (Open Support & Resources)
        </button>
        ${
          isCompleted
            ? `<button type="button" class="btn btn-outline btn-sm uncomplete-btn" data-mod-id="${mod.module_id}">Undo</button>`
            : ''
        }
      </div>
    </div>
  `
    : '';

  // Seamless Next-Module Transition Bar inside completed module
  const nextModInCourse = allModules.find(m => m.module_id === mod.module_id + 1);
  const transitionBannerHtml =
    isCompleted && nextModInCourse
      ? `
    <div class="next-module-transition">
      <span><strong>✓ Module ${mod.module_id} Complete!</strong> Up next: <em>Module ${nextModInCourse.module_id}: ${escapeHtml(nextModInCourse.zybooks_sections.map(s => s.section).join(' & '))}</em></span>
      <button type="button" class="btn btn-primary btn-sm jump-next-mod-btn" data-current-id="${mod.module_id}" data-next-id="${nextModInCourse.module_id}">
        Continue to Module ${nextModInCourse.module_id} &darr;
      </button>
    </div>
  `
      : '';

  card.innerHTML = `
    <div class="module-card-header" data-toggle-card="${mod.module_id}">
      <div class="module-header-left">
        <div class="module-status-dot">${isCompleted ? '✓' : mod.module_id}</div>
        <div class="module-title-block">
          <h3>Module ${mod.module_id}: ${escapeHtml(sectionTitle)}</h3>
          <div class="module-meta-line">
            <span>Chapter ${mod.chapter}</span> •
            <span>${escapeHtml(mod.competency)}</span>
          </div>
        </div>
      </div>
      <div class="module-header-right">
        ${badgesHtml}
        <span class="chevron-icon">▼</span>
      </div>
    </div>

    <div class="module-card-body">
      ${ch4BannerHtml}

      <div class="module-section-grid">
        <div class="content-box">
          <h4>1. Zybooks Reading & Labs (Complete First)</h4>
          <ul class="zybooks-list">${zybooksHtml}</ul>
        </div>
        <div class="content-box">
          <h4>2. Key Concepts & Focus Topics</h4>
          <ul class="topics-list">${topicsHtml}</ul>
        </div>
      </div>

      ${masteryGateHtml}
      ${completionBarHtml}
      ${resourcesSectionHtml}
      ${transitionBannerHtml}
    </div>
  `;

  return card;
}

/**
 * Re-renders a single module card in place without collapsing it or jumping the page scroll.
 */
function updateSingleModuleCardInPlace(modId) {
  const existingCard = document.getElementById(`moduleCard_${modId}`);
  const mod = allModules.find(m => m.module_id === modId);
  if (!existingCard || !mod) {
    renderMainView();
    return;
  }

  const nextActiveId = getNextActiveModuleId();
  const newCard = createModuleCardElement(mod, nextActiveId);
  existingCard.replaceWith(newCard);

  // Also refresh active border highlight on all visible cards
  document.querySelectorAll('.module-card').forEach(el => {
    const id = Number(el.id.replace('moduleCard_', ''));
    if (id === nextActiveId) {
      el.classList.add('active-module');
    } else {
      el.classList.remove('active-module');
    }
  });

  attachModuleCardListeners();
}

function attachModuleCardListeners() {
  // Expand / Collapse Card Header (Persisted in appState.expandedCards)
  document.querySelectorAll('[data-toggle-card]').forEach(header => {
    header.onclick = () => {
      const modId = Number(header.dataset.toggleCard);
      const card = header.closest('.module-card');
      const isNowExpanded = !card.classList.contains('expanded');
      card.classList.toggle('expanded', isNowExpanded);
      appState.expandedCards[modId] = isNowExpanded;
      saveStateToStorage();
    };
  });

  // Confidence Rating Buttons (Easy, Shaky, Hard) — Seamless In-Place Update!
  document.querySelectorAll('.btn-conf').forEach(btn => {
    btn.onclick = e => {
      e.stopPropagation();
      const modId = Number(btn.dataset.modId);
      const conf = btn.dataset.conf;

      appState.completedModules[modId] = {
        completedAt: new Date().toISOString(),
        confidence: conf
      };

      // Keep the current card open so it never snaps shut unexpectedly!
      appState.expandedCards[modId] = true;

      if (conf === 'shaky' || conf === 'hard') {
        appState.expandedResources[modId] = true;
      }

      // Also auto-expand the next active module so it is ready when they scroll down
      const nextActiveId = getNextActiveModuleId();
      if (nextActiveId) {
        appState.expandedCards[nextActiveId] = true;
      }

      saveStateToStorage();
      renderHeaderMetrics();
      renderDynamicAlerts();
      updateSingleModuleCardInPlace(modId);
      if (nextActiveId) {
        updateSingleModuleCardInPlace(nextActiveId);
      }
    };
  });

  // Smooth "Continue to Next Module" button inside completed card
  document.querySelectorAll('.jump-next-mod-btn').forEach(btn => {
    btn.onclick = e => {
      e.stopPropagation();
      const nextId = Number(btn.dataset.nextId);
      appState.expandedCards[nextId] = true;
      saveStateToStorage();

      let nextCardEl = document.getElementById(`moduleCard_${nextId}`);
      if (!nextCardEl && appState.viewMode === 'sprint') {
        // Next module is in the following week's sprint
        appState.currentWeekIndex++;
        saveStateToStorage();
        renderSprintQueue();
        nextCardEl = document.getElementById(`moduleCard_${nextId}`);
      }
      if (nextCardEl) {
        nextCardEl.classList.add('expanded');
        nextCardEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    };
  });

  // Undo Completion Button
  document.querySelectorAll('.uncomplete-btn').forEach(btn => {
    btn.onclick = e => {
      e.stopPropagation();
      const modId = Number(btn.dataset.modId);
      delete appState.completedModules[modId];
      appState.expandedCards[modId] = true;
      saveStateToStorage();
      renderHeaderMetrics();
      renderDynamicAlerts();
      updateSingleModuleCardInPlace(modId);
    };
  });

  // 80% Mastery Gate Verification Button (With Encouragement Banner)
  document.querySelectorAll('.verify-score-btn').forEach(btn => {
    btn.onclick = e => {
      e.stopPropagation();
      const modId = Number(btn.dataset.modId);
      const inputEl = document.getElementById(`quizScoreInput_${modId}`);
      const warningEl = document.getElementById(`masteryWarning_${modId}`);
      const successEl = document.getElementById(`masterySuccess_${modId}`);
      const score = Number(inputEl.value);

      if (!inputEl.value || isNaN(score)) {
        inputEl.focus();
        return;
      }

      // Always keep card open so student sees feedback banner!
      appState.expandedCards[modId] = true;

      if (score < 80) {
        warningEl.classList.remove('hidden');
        if (successEl) successEl.classList.add('hidden');
        appState.expandedResources[modId] = true;
        const resDrawer = document.getElementById(`resDrawer_${modId}`);
        if (resDrawer) resDrawer.classList.remove('hidden');
        saveStateToStorage();
      } else {
        warningEl.classList.add('hidden');
        appState.completedModules[modId] = {
          completedAt: new Date().toISOString(),
          confidence: 'easy',
          quizScore: score
        };

        const nextActiveId = getNextActiveModuleId();
        if (nextActiveId) {
          appState.expandedCards[nextActiveId] = true;
        }

        saveStateToStorage();
        renderHeaderMetrics();
        renderDynamicAlerts();
        updateSingleModuleCardInPlace(modId);
        if (nextActiveId) {
          updateSingleModuleCardInPlace(nextActiveId);
        }
      }
    };
  });

  // Toggle Supplemental Resources Drawer (In-Place without closing card)
  document.querySelectorAll('.toggle-res-drawer-btn').forEach(btn => {
    btn.onclick = e => {
      e.stopPropagation();
      const modId = Number(btn.dataset.modId);
      const drawer = document.getElementById(`resDrawer_${modId}`);
      const isHidden = drawer.classList.contains('hidden');
      appState.expandedResources[modId] = isHidden;
      appState.expandedCards[modId] = true;
      saveStateToStorage();
      updateSingleModuleCardInPlace(modId);
    };
  });

  // Show All Supplemental Resources Toggle (In-Place without closing card)
  document.querySelectorAll('.show-all-res-btn').forEach(btn => {
    btn.onclick = e => {
      e.stopPropagation();
      const modId = Number(btn.dataset.modId);
      appState.showAllResources[modId] = !appState.showAllResources[modId];
      appState.expandedResources[modId] = true;
      appState.expandedCards[modId] = true;
      saveStateToStorage();
      updateSingleModuleCardInPlace(modId);
    };
  });
}

/* ==========================================================================
   Pre-Assessment (PA) Modal & Iterative Remediation
   ========================================================================== */

function openPaModal() {
  const modal = document.getElementById('paAnalyzerModal');
  modal.classList.remove('hidden');

  if (appState.paReport) {
    document.getElementById('paOverallScore').value = appState.paReport.overallScore || '';
    document.getElementById('comp1Score').value = appState.paReport.comp1Score || 'Approaching Competence';
    document.getElementById('comp2Score').value = appState.paReport.comp2Score || 'Approaching Competence';
    document.getElementById('comp3Score').value = appState.paReport.comp3Score || 'Approaching Competence';
    document.getElementById('flagDbMgmt').checked = Boolean(appState.paReport.flagDbMgmt);
    document.getElementById('flagIntroDb').checked = Boolean(appState.paReport.flagIntroDb);
    document.getElementById('flagComplexQueries').checked = Boolean(appState.paReport.flagComplexQueries);
    document.getElementById('flagDbDesign').checked = Boolean(appState.paReport.flagDbDesign);
    document.getElementById('flagNormalization').checked = Boolean(appState.paReport.flagNormalization);
    document.getElementById('flagIndexes').checked = Boolean(appState.paReport.flagIndexes);
  }
}

/* ==========================================================================
   FAQ Modal Rendering
   ========================================================================== */

function openFaqModal() {
  const modal = document.getElementById('faqModal');
  modal.classList.remove('hidden');

  const categories = ['All', ...new Set(faqItems.map(item => item.category))];
  const tabsContainer = document.getElementById('faqCategoryTabs');

  const renderFaqCategory = (selectedCat) => {
    tabsContainer.innerHTML = categories
      .map(
        cat => `
      <button type="button" class="chip ${cat === selectedCat ? 'active' : ''}" data-faq-cat="${escapeHtml(cat)}">
        ${escapeHtml(cat)}
      </button>
    `
      )
      .join('');

    tabsContainer.querySelectorAll('[data-faq-cat]').forEach(btn => {
      btn.addEventListener('click', () => renderFaqCategory(btn.dataset.faqCat));
    });

    const filtered =
      selectedCat === 'All' ? faqItems : faqItems.filter(f => f.category === selectedCat);

    const listContainer = document.getElementById('faqListContainer');
    listContainer.innerHTML = filtered
      .map(
        (item, idx) => `
      <div class="faq-item">
        <button type="button" class="faq-question" data-faq-idx="${idx}">
          <span>${escapeHtml(item.question)}</span>
          <span>▾</span>
        </button>
        <div class="faq-answer ${idx === 0 ? '' : 'hidden'}">${linkifyText(escapeHtml(item.answer))}</div>
      </div>
    `
      )
      .join('');

    listContainer.querySelectorAll('.faq-question').forEach(qBtn => {
      qBtn.addEventListener('click', () => {
        const ans = qBtn.nextElementSibling;
        ans.classList.toggle('hidden');
      });
    });
  };

  renderFaqCategory('All');
}

/* ==========================================================================
   Date Modal & Event Listeners
   ========================================================================== */

function openDateModal() {
  const modal = document.getElementById('dateModal');
  const input = document.getElementById('newTargetDateInput');
  input.min = formatDateISO(new Date());
  input.value = appState.targetOaDate || formatDateISO(new Date());
  modal.classList.remove('hidden');
}

function setupEventListeners() {
  const obForm = document.getElementById('onboardingForm');
  obForm.addEventListener('change', handleOnboardingInputChanges);

  obForm.addEventListener('submit', e => {
    e.preventDefault();
    const name = document.getElementById('studentNameInput').value.trim();
    const dbExp = Number(document.querySelector('input[name="dbExp"]:checked').value);
    const sqlExp = dbExp === 0 ? 0 : Number(document.querySelector('input[name="sqlExp"]:checked').value);
    const studyStyle = document.querySelector('input[name="studyStyle"]:checked').value;
    const weeklyHours = document.querySelector('input[name="weeklyHours"]:checked').value;
    const targetDate = document.getElementById('targetOaDateInput').value;
    const learningPref = document.querySelector('input[name="learningPref"]:checked').value;
    const hasTakenPaVal = document.querySelector('input[name="hasTakenPa"]:checked').value;

    appState.onboarded = true;
    appState.studentName = name;
    if (!appState.startDate) {
      appState.startDate = formatDateISO(new Date());
    }
    appState.targetOaDate = targetDate;
    appState.dbExp = dbExp;
    appState.sqlExp = sqlExp;
    appState.studyStyle = studyStyle;
    appState.weeklyHours = weeklyHours;
    appState.learningPref = learningPref;
    appState.track = calculateInvisibleTrack(dbExp, sqlExp);
    appState.hasTakenPa = hasTakenPaVal === 'yes';

    ensureNextActiveModuleExpanded();
    saveStateToStorage();
    document.getElementById('onboardingModal').classList.add('hidden');
    initializeDashboard();

    if (appState.hasTakenPa) {
      openPaModal();
    }
  });

  // PA Analyzer Submit
  document.getElementById('paAnalyzerForm').addEventListener('submit', e => {
    e.preventDefault();
    const isRetake = Boolean(appState.paReport);

    const report = {
      overallScore: document.getElementById('paOverallScore').value,
      comp1Score: document.getElementById('comp1Score').value,
      comp2Score: document.getElementById('comp2Score').value,
      comp3Score: document.getElementById('comp3Score').value,
      flagDbMgmt: document.getElementById('flagDbMgmt').checked,
      flagIntroDb: document.getElementById('flagIntroDb').checked,
      flagComplexQueries: document.getElementById('flagComplexQueries').checked,
      flagDbDesign: document.getElementById('flagDbDesign').checked,
      flagNormalization: document.getElementById('flagNormalization').checked,
      flagIndexes: document.getElementById('flagIndexes').checked,
      updatedAt: new Date().toISOString()
    };

    const hasAnyFlags =
      report.flagDbMgmt ||
      report.flagIntroDb ||
      report.flagComplexQueries ||
      report.flagDbDesign ||
      report.flagNormalization ||
      report.flagIndexes;

    appState.hasTakenPa = true;
    appState.paReport = report;
    if (isRetake && hasAnyFlags) {
      appState.quickPlanActive = true;
    }

    ensureNextActiveModuleExpanded();
    saveStateToStorage();
    document.getElementById('paAnalyzerModal').classList.add('hidden');
    initializeDashboard();
  });

  document.getElementById('cancelPaModalBtn').addEventListener('click', () => {
    document.getElementById('paAnalyzerModal').classList.add('hidden');
  });

  // Top & Bottom Sprint Week Navigation
  const goPrevWeek = () => {
    if (appState.currentWeekIndex > 0) {
      appState.currentWeekIndex--;
      saveStateToStorage();
      renderSprintQueue();
      document.getElementById('sprintNavSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };
  const goNextWeek = () => {
    appState.currentWeekIndex++;
    saveStateToStorage();
    renderSprintQueue();
    document.getElementById('sprintNavSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  document.getElementById('prevWeekBtn').addEventListener('click', goPrevWeek);
  document.getElementById('nextWeekBtn').addEventListener('click', goNextWeek);
  document.getElementById('prevWeekBottomBtn').addEventListener('click', goPrevWeek);
  document.getElementById('nextWeekBottomBtn').addEventListener('click', goNextWeek);

  // View Mode Toggle
  const toggleViewMode = () => {
    appState.viewMode = appState.viewMode === 'sprint' ? 'full' : 'sprint';
    saveStateToStorage();
    renderMainView();
  };
  document.getElementById('viewModeToggleBtn').addEventListener('click', toggleViewMode);
  document.getElementById('openPaModalBtn').addEventListener('click', openPaModal);

  // Full Plan Chapter Filter Chips
  document.querySelectorAll('#chapterFilterGroup .chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#chapterFilterGroup .chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      appState.chapterFilter = chip.dataset.chapter;
      renderFullPlanQueue();
    });
  });

  // Full Plan Confidence / Status Filter Chips
  document.querySelectorAll('#confidenceFilterGroup .chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#confidenceFilterGroup .chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      appState.confidenceFilter = chip.dataset.confFilter;
      renderFullPlanQueue();
    });
  });

  document.getElementById('showOptionalToggle').addEventListener('change', e => {
    appState.showOptional = e.target.checked;
    renderFullPlanQueue();
  });

  // Hamburger Side Menu
  const openSideMenu = () => {
    document.getElementById('menuBackdrop').classList.remove('hidden');
    document.getElementById('sideMenuDrawer').classList.remove('hidden');
  };
  const closeSideMenu = () => {
    document.getElementById('menuBackdrop').classList.add('hidden');
    document.getElementById('sideMenuDrawer').classList.add('hidden');
  };

  document.getElementById('hamburgerBtn').addEventListener('click', openSideMenu);
  document.getElementById('closeMenuBtn').addEventListener('click', closeSideMenu);
  document.getElementById('menuBackdrop').addEventListener('click', closeSideMenu);

  document.getElementById('menuFaqBtn').addEventListener('click', () => {
    closeSideMenu();
    openFaqModal();
  });
  document.getElementById('closeFaqModalBtn').addEventListener('click', () => {
    document.getElementById('faqModal').classList.add('hidden');
  });

  document.getElementById('menuPaUpdaterBtn').addEventListener('click', () => {
    closeSideMenu();
    openPaModal();
  });

  document.getElementById('menuToggleFullPlanBtn').addEventListener('click', () => {
    closeSideMenu();
    toggleViewMode();
  });

  document.getElementById('menuRetakeOnboardingBtn').addEventListener('click', () => {
    closeSideMenu();
    openOnboardingModal();
  });

  document.getElementById('resetProgressBtn').addEventListener('click', () => {
    if (confirm('Are you sure you want to reset your study plan settings and module completion progress?')) {
      localStorage.removeItem(STORAGE_KEY);
      window.location.reload();
    }
  });

  // Date Adjustment Modal
  document.getElementById('editTargetDateBtn').addEventListener('click', openDateModal);
  document.getElementById('cancelDateModalBtn').addEventListener('click', () => {
    document.getElementById('dateModal').classList.add('hidden');
  });
  document.getElementById('dateModalForm').addEventListener('submit', e => {
    e.preventDefault();
    appState.targetOaDate = document.getElementById('newTargetDateInput').value;
    appState.currentWeekIndex = 0;
    saveStateToStorage();
    document.getElementById('dateModal').classList.add('hidden');
    initializeDashboard();
  });

  // Floating Support Button Popup
  const supportBtn = document.getElementById('supportFabBtn');
  const supportMenu = document.getElementById('supportPopupMenu');
  supportBtn.addEventListener('click', e => {
    e.stopPropagation();
    supportMenu.classList.toggle('hidden');
  });
  document.addEventListener('click', e => {
    if (!supportMenu.contains(e.target) && e.target !== supportBtn) {
      supportMenu.classList.add('hidden');
    }
  });
}

/* ==========================================================================
   Utility Helpers
   ========================================================================== */

function formatDateISO(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatDateShort(dateObj) {
  return dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function getDaysBetween(d1, d2) {
  const msPerDay = 1000 * 60 * 60 * 24;
  const utc1 = Date.UTC(d1.getFullYear(), d1.getMonth(), d1.getDate());
  const utc2 = Date.UTC(d2.getFullYear(), d2.getMonth(), d2.getDate());
  return Math.ceil((utc2 - utc1) / msPerDay);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function linkifyText(escapedText) {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  return escapedText.replace(
    urlRegex,
    url => `<a href="${url}" target="_blank" rel="noopener noreferrer" class="resource-link">${url}</a>`
  );
}
