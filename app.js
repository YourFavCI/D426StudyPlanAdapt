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
  studyStyle: 'steady',
  weeklyHours: '10to15',
  learningPref: 'visual', // 'visual', 'text', 'handson'
  track: 'foundations',   // 'foundations', 'standard', 'fasttrack' (internal only)
  hasTakenPa: false,
  paReport: null,         // Stores Coaching Report scores & flags
  quickPlanActive: false, // Activated on subsequent PA retakes with flags
  completedModules: {},   // { [module_id]: { completedAt, confidence, quizScore } }
  expandedResources: {},  // { [module_id]: boolean }
  showAllResources: {},   // { [module_id]: boolean }
  currentWeekIndex: 0,
  viewMode: 'sprint',     // 'sprint' or 'full'
  chapterFilter: 'all',
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
    initializeDashboard();
  }
});

function loadStateFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      appState = { ...appState, ...parsed };
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
   Onboarding & Invisible Track Calculation
   ========================================================================== */

function openOnboardingModal() {
  const modal = document.getElementById('onboardingModal');
  modal.classList.remove('hidden');

  // Set default target date to 28 days from today if not set
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

function calculateInvisibleTrack(dbExp, sqlExp) {
  if (dbExp === 2 || sqlExp === 2) {
    return 'fasttrack';
  }
  if (dbExp === 0 && sqlExp === 0) {
    return 'foundations';
  }
  return 'standard';
}

function checkShortTimelineWarning() {
  const dbExpEl = document.querySelector('input[name="dbExp"]:checked');
  const sqlExpEl = document.querySelector('input[name="sqlExp"]:checked');
  const dateInput = document.getElementById('targetOaDateInput');
  const warningEl = document.getElementById('shortTimelineWarning');

  if (!dbExpEl || !sqlExpEl || !dateInput.value) return;

  const isBeginner = Number(dbExpEl.value) === 0 && Number(sqlExpEl.value) === 0;
  const daysUntil = getDaysBetween(new Date(), new Date(dateInput.value + 'T00:00:00'));

  if (isBeginner && daysUntil < 18) {
    warningEl.classList.remove('hidden');
  } else {
    warningEl.classList.add('hidden');
  }
}

/* ==========================================================================
   Adaptive Module Status & PA Coaching Report Logic
   ========================================================================== */

/**
 * Determines module status ('required', 'optional', 'critical') based on
 * PA Coaching Report inputs and current track.
 */
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
   Weekly Sprints Distribution (Weighted by Length & Difficulty)
   ========================================================================== */

function buildWeeklySprints() {
  const start = appState.startDate ? new Date(appState.startDate + 'T00:00:00') : new Date();
  const target = appState.targetOaDate ? new Date(appState.targetOaDate + 'T00:00:00') : new Date();

  const totalDays = Math.max(1, getDaysBetween(start, target));
  const numWeeks = Math.max(1, Math.ceil(totalDays / 7));

  // Filter modules if Quick Plan is active (only Critical or Milestone modules)
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

  // Active required/critical modules get distributed across the weeks by weight
  const totalWeight = queue.reduce((acc, m) => acc + m.weight, 0);
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
    if (weekEnd > target) weekEnd.setTime(target.getTime());

    return {
      weekNumber: idx + 1,
      dateRangeLabel: `${formatDateShort(weekStart)} – ${formatDateShort(weekEnd)}`,
      modules: bucket
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

  // Sort so preferred style is prioritized, while keeping a balanced mix
  const preferred = resources.filter(matchesPref);
  const others = resources.filter(r => !matchesPref(r));

  let curated = [];
  if (resources.length <= 4 || appState.showAllResources[mod.module_id]) {
    curated = [...preferred, ...others];
    return { visible: curated, total: resources.length, hasMore: resources.length > 4 };
  }

  // Pick up to 2 preferred + 2 other styles so student gets variety without overload
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
   Dashboard Rendering
   ========================================================================== */

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

  // Calculate Overall Progress (Required/Critical modules)
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

  // 1. Silent Mastery Completion Check
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

  // 2. Fast-Track Day 1 Custom Module ("Take the Pre-Assessment")
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

  // 3. Delayed Pre-Assessment Checkpoint (Appears after Module 19 / End of Chapter 3 if PA not taken)
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

  // 4. Pacing Recalibration Trigger (Percentage of timeline elapsed vs. completion lag)
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

  // 5. Quick Plan Banner (when active after PA retake)
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
  const sprintNav = document.getElementById('sprintNavSection');
  const fullFilterBar = document.getElementById('fullPlanFilterBar');
  const viewModeBtn = document.getElementById('viewModeToggleBtn');
  const menuPlanLabel = document.getElementById('menuTogglePlanLabel');

  if (appState.viewMode === 'sprint') {
    sprintNav.classList.remove('hidden');
    fullFilterBar.classList.add('hidden');
    viewModeBtn.textContent = 'View Full Study Plan';
    menuPlanLabel.textContent = 'Switch to Full Study Plan View';
    renderSprintQueue();
  } else {
    sprintNav.classList.add('hidden');
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
  document.getElementById('sprintTitle').textContent = `Week ${currentWeek.weekNumber} of ${weeks.length} Sprint`;
  document.getElementById('sprintSubtitle').textContent =
    `${currentWeek.dateRangeLabel} • ${currentWeek.modules.length} Modules in Queue`;

  document.getElementById('prevWeekBtn').disabled = appState.currentWeekIndex === 0;
  document.getElementById('nextWeekBtn').disabled = appState.currentWeekIndex >= weeks.length - 1;

  renderModuleCards(currentWeek.modules);
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

  renderModuleCards(list);
}

function renderModuleCards(modulesList) {
  const container = document.getElementById('modulesContainer');
  container.innerHTML = '';

  // Find the immediate next uncompleted non-optional module across the entire course
  const nextActiveModule = allModules.find(
    m => !appState.completedModules[m.module_id] && getModuleAdaptiveState(m).status !== 'optional'
  );
  const nextActiveId = nextActiveModule ? nextActiveModule.module_id : null;

  modulesList.forEach(mod => {
    const isCompleted = Boolean(appState.completedModules[mod.module_id]);
    const compData = appState.completedModules[mod.module_id] || {};
    const isNextActive = mod.module_id === nextActiveId;
    const adaptiveStatus = mod.adaptiveStatus || getModuleAdaptiveState(mod).status;

    const card = document.createElement('article');
    card.className = 'module-card';
    if (isNextActive) card.classList.add('active-module', 'expanded');
    if (isCompleted) card.classList.add('completed-module');
    if (adaptiveStatus === 'optional') card.classList.add('optional-module');

    const sectionTitle = mod.zybooks_sections.map(s => s.section).join(' & ');

    // Status Badges
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
      badgesHtml += `<span class="badge badge-completed">✓ Completed</span>`;
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

    // Zybooks sections list
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

    // Topics list
    const topicsHtml = mod.topics.map(t => `<li>${escapeHtml(t)}</li>`).join('');

    // Determine if supplemental resources drawer should be open automatically
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

    // Extra Support Callout if student rated module as 'shaky' or 'hard'
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

    // 80% Mastery Gate for End of Chapter 1 (Mod 4) & Chapter 2 (Mod 10)
    const masteryGateHtml = mod.is_mastery_gate
      ? `
      <div class="mastery-gate-box">
        <strong>80% Mastery Checkpoint:</strong> Enter your Zybooks Practice Quiz score (%) to verify readiness before moving forward:
        <div class="mastery-gate-row">
          <input type="number" min="0" max="100" placeholder="e.g., 85" class="score-input" id="quizScoreInput_${mod.module_id}" value="${compData.quizScore || ''}" />
          <button type="button" class="btn btn-primary btn-sm verify-score-btn" data-mod-id="${mod.module_id}">
            Verify Score & Complete Module
          </button>
        </div>
        <div id="masteryWarning_${mod.module_id}" class="mastery-warning hidden">
          <strong>Score Below 80%:</strong> We strongly recommend reviewing the supplemental resources above or emailing <strong>d426@wgu.edu</strong> / your assigned Course Instructor before moving to the next chapter!
        </div>
      </div>
    `
      : '';

    // Standard Confidence Rating Bar
    const completionBarHtml = !mod.is_mastery_gate
      ? `
      <div class="completion-bar">
        <span class="confidence-prompt">
          ${isCompleted ? 'Module Completed! Update your confidence rating:' : 'Finished the Zybooks reading/labs? Rate your confidence to complete:'}
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
      </div>
    `;

    container.appendChild(card);
  });

  attachModuleCardListeners();
}

function attachModuleCardListeners() {
  // Expand / Collapse Card Header
  document.querySelectorAll('[data-toggle-card]').forEach(header => {
    header.addEventListener('click', () => {
      const card = header.closest('.module-card');
      card.classList.toggle('expanded');
    });
  });

  // Confidence Rating Buttons (Easy, Shaky, Hard)
  document.querySelectorAll('.btn-conf').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const modId = Number(btn.dataset.modId);
      const conf = btn.dataset.conf;

      appState.completedModules[modId] = {
        completedAt: new Date().toISOString(),
        confidence: conf
      };

      if (conf === 'shaky' || conf === 'hard') {
        appState.expandedResources[modId] = true;
      }

      saveStateToStorage();
      initializeDashboard();
    });
  });

  // Undo Completion Button
  document.querySelectorAll('.uncomplete-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const modId = Number(btn.dataset.modId);
      delete appState.completedModules[modId];
      saveStateToStorage();
      initializeDashboard();
    });
  });

  // 80% Mastery Gate Verification Button
  document.querySelectorAll('.verify-score-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const modId = Number(btn.dataset.modId);
      const inputEl = document.getElementById(`quizScoreInput_${modId}`);
      const warningEl = document.getElementById(`masteryWarning_${modId}`);
      const score = Number(inputEl.value);

      if (!inputEl.value || isNaN(score)) {
        inputEl.focus();
        return;
      }

      if (score < 80) {
        warningEl.classList.remove('hidden');
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
        saveStateToStorage();
        initializeDashboard();
      }
    });
  });

  // Toggle Supplemental Resources Drawer
  document.querySelectorAll('.toggle-res-drawer-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const modId = Number(btn.dataset.modId);
      const drawer = document.getElementById(`resDrawer_${modId}`);
      const isHidden = drawer.classList.contains('hidden');
      appState.expandedResources[modId] = isHidden;
      saveStateToStorage();
      renderMainView();
    });
  });

  // Show All Supplemental Resources Toggle
  document.querySelectorAll('.show-all-res-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const modId = Number(btn.dataset.modId);
      appState.showAllResources[modId] = !appState.showAllResources[modId];
      appState.expandedResources[modId] = true;
      saveStateToStorage();
      renderMainView();
    });
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
  // Onboarding Form Live Warning Check
  const obForm = document.getElementById('onboardingForm');
  obForm.addEventListener('change', checkShortTimelineWarning);

  // Onboarding Form Submit
  obForm.addEventListener('submit', e => {
    e.preventDefault();
    const name = document.getElementById('studentNameInput').value.trim();
    const dbExp = Number(document.querySelector('input[name="dbExp"]:checked').value);
    const sqlExp = Number(document.querySelector('input[name="sqlExp"]:checked').value);
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
    // Iterative Remediation: If updating PA again and flags remain, trigger Quick Plan
    if (isRetake && hasAnyFlags) {
      appState.quickPlanActive = true;
    }

    saveStateToStorage();
    document.getElementById('paAnalyzerModal').classList.add('hidden');
    initializeDashboard();
  });

  document.getElementById('cancelPaModalBtn').addEventListener('click', () => {
    document.getElementById('paAnalyzerModal').classList.add('hidden');
  });

  // Sprint Week Navigation
  document.getElementById('prevWeekBtn').addEventListener('click', () => {
    if (appState.currentWeekIndex > 0) {
      appState.currentWeekIndex--;
      saveStateToStorage();
      renderSprintQueue();
    }
  });

  document.getElementById('nextWeekBtn').addEventListener('click', () => {
    appState.currentWeekIndex++;
    saveStateToStorage();
    renderSprintQueue();
  });

  // View Mode Toggle
  const toggleViewMode = () => {
    appState.viewMode = appState.viewMode === 'sprint' ? 'full' : 'sprint';
    saveStateToStorage();
    renderMainView();
  };
  document.getElementById('viewModeToggleBtn').addEventListener('click', toggleViewMode);
  document.getElementById('openPaModalBtn').addEventListener('click', openPaModal);

  // Full Plan Chapter Filter Chips
  document.querySelectorAll('#fullPlanFilterBar .chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#fullPlanFilterBar .chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      appState.chapterFilter = chip.dataset.chapter;
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
