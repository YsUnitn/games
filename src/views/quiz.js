import { h, mount, header, uid, shuffle } from '../lib/ui.js';
import { invitePanel } from '../lib/lobby.js';
import { saveRoom, gameShell, ensureName } from './play.js';
import { confetti } from './guesswho.js';

const other = (p) => (p === 'host' ? 'guest' : 'host');

export const QUESTIONS = [
  'Qual è il mio piatto preferito?', 'Qual è il mio film preferito?', 'Dove vorrei andare in viaggio?', 'Qual è la mia più grande paura?',
  'Qual è il mio colore preferito?', 'Che lavoro avrei voluto fare da piccolo/a?', 'Qual è la mia canzone del momento?', 'Cosa ordino sempre al bar?',
  'Qual è il mio snack da divano?', 'Qual è il ricordo più bello di noi due?', 'Cosa mi ha colpito di te la prima volta?', 'Qual è il mio difetto più grande?',
  'Qual è il mio pregio più grande?', 'Che superpotere vorrei avere?', 'Qual è la mia serie TV preferita?', 'Quale animale sarei?',
  'Qual è il mio peggior incubo in cucina?', 'Cosa faccio quando sono stressato/a?', 'Qual è il mio gusto di gelato preferito?', 'Qual è la cosa che mi fa ridere di più?',
  'Qual è il mio posto preferito dove siamo stati insieme?', 'Mare o montagna?', 'Colazione dolce o salata?', 'Cosa farei con 1 milione di euro?',
  'Qual è il mio sogno nel cassetto?', 'Qual è la mia parolaccia preferita?', 'Chi è il mio cantante preferito?', 'Qual è il regalo più bello che ti ho fatto?',
  'Qual è la mia stagione preferita?', 'Qual è il mio personaggio dei cartoni preferito?', 'Come mi piace passare la domenica?', 'Cosa mi fa arrabbiare subito?',
  'Qual è il mio profumo/odore preferito?', 'Qual è la mia pizza preferita?', 'Quanti figli/animali vorrei?', 'Qual è stata la mia prima impressione su di te?',
  'Qual è il mio libro preferito?', 'In che città vorrei vivere?', 'Qual è la mia bevanda preferita?', 'Cosa porterei su un’isola deserta?',
  'Qual è la mia app più usata?', 'Qual è la mia mania più strana?', 'Qual è il mio sport preferito?', 'Qual è il mio numero preferito?',
  'Qual è stato il nostro primo appuntamento?', 'Qual è il soprannome che preferisco?', 'Cosa cambierei della mia routine?', 'Chi è il mio migliore amico/a?',
];

export async function quizSetup(root) {
  const rounds = h('select', { class: 'input' }, [6, 10, 16, 20].map((n) => h('option', { value: n, selected: n === 10 }, `${n} domande (${n / 2} a testa)`)));
  const custom = h('textarea', { class: 'input', rows: 5, placeholder: 'Domande vostre, una per riga (facoltativo)\nEs: Qual è il nome del mio primo gatto?' });
  const onlyCustom = h('input', { type: 'checkbox' });
  mount(root, header('Quanto mi conosci?'),
    h('div', { class: 'card' }, h('p', {}, 'A turno uno risponde su di sé in segreto, l’altro prova a indovinare. Poi si svelano le risposte e chi ha risposto decide se è giusto. 💞')),
    h('div', { class: 'card stack' },
      h('label', { class: 'label' }, 'Durata'), rounds,
      h('label', { class: 'label' }, 'Domande personalizzate'), custom,
      h('label', { class: 'row tight small' }, onlyCustom, 'Usa solo le mie domande'),
    ),
    h('div', { class: 'sticky-bottom' }, h('button', { class: 'btn primary big', onclick: async () => {
      const name = await ensureName(); if (!name) return;
      const mine = custom.value.split('\n').map((x) => x.trim()).filter(Boolean);
      const pool = onlyCustom.checked && mine.length ? shuffle(mine) : [...shuffle(mine), ...shuffle(QUESTIONS)];
      const id = 'gdc-' + uid(8);
      saveRoom(id, 'quiz', {
        phase: 'lobby', pool, qi: 0, round: 0, total: +rounds.value, subject: 'host',
        answers: { subject: null, guess: null }, verdict: null, score: { host: 0, guest: 0 }, history: [],
        names: { host: name, guest: null },
      });
      location.hash = `#/play/quiz/${id}`;
    } }, '🎮 Crea partita')),
  );
}

function reducer(s, a) {
  const by = a.by;
  const q = s.pool[s.qi % s.pool.length];
  switch (a.type) {
    case 'join': return { ...s, names: { ...s.names, guest: a.name }, phase: s.phase === 'lobby' ? 'answer' : s.phase };
    case 'skip':
      if (s.phase !== 'answer' || by !== s.subject || s.answers.subject || s.answers.guess) return s;
      return { ...s, qi: s.qi + 1 };
    case 'submit': {
      if (s.phase !== 'answer' || !a.text?.trim()) return s;
      const slot = by === s.subject ? 'subject' : 'guess';
      const answers = { ...s.answers, [slot]: a.text.trim().slice(0, 300) };
      return { ...s, answers, phase: answers.subject && answers.guess ? 'reveal' : 'answer' };
    }
    case 'judge': {
      if (s.phase !== 'reveal' || by !== s.subject || s.verdict != null) return s;
      const pts = a.value === 'yes' ? 2 : a.value === 'half' ? 1 : 0;
      const g = other(s.subject);
      return { ...s, verdict: a.value, score: { ...s.score, [g]: s.score[g] + pts },
        history: [...s.history, { q, who: s.subject, answer: s.answers.subject, guess: s.answers.guess, verdict: a.value }] };
    }
    case 'next': {
      if (s.phase !== 'reveal' || s.verdict == null) return s;
      const round = s.round + 1;
      if (round >= s.total) return { ...s, phase: 'over', round };
      return { ...s, round, qi: s.qi + 1, subject: other(s.subject), answers: { subject: null, guess: null }, verdict: null, phase: 'answer' };
    }
    case 'restart':
      return { ...s, phase: 'answer', round: 0, qi: s.qi + 1, subject: 'host', answers: { subject: null, guess: null }, verdict: null, score: { host: 0, guest: 0 }, history: [] };
    default: return s;
  }
}

function render(session, root) {
  const me = session.me, op = other(me);
  const body = gameShell(root, session, 'Quanto mi conosci?');
  let key = '';
  const VERD = { yes: '✅ Indovinato (+2)', half: '🤏 Quasi (+1)', no: '❌ Sbagliato' };

  const draw = () => {
    const s = session.state;
    if (!s) { mount(body, h('div', { class: 'center-msg' }, h('div', { class: 'spinner' }), h('p', {}, 'Ricevo la partita…'))); return; }
    const k = JSON.stringify([s.phase, s.round, s.qi, s.answers, s.verdict, s.names]);
    if (k === key) return; // evita di cancellare quello che stai scrivendo
    key = k;
    const q = s.pool[s.qi % s.pool.length];
    const score = h('div', { class: 'scorebar' }, h('span', {}, `${s.names.host} ${s.score.host}`), h('span', { class: 'muted' }, `${Math.min(s.round + 1, s.total)}/${s.total}`), h('span', {}, `${s.score.guest} ${s.names.guest || '…'}`));

    if (s.phase === 'lobby') { mount(body, h('div', { class: 'card center' }, h('h2', {}, '💞 Quanto mi conosci?')), invitePanel(session.room)); return; }

    if (s.phase === 'over') {
      const w = s.score.host === s.score.guest ? null : s.score.host > s.score.guest ? 'host' : 'guest';
      if (w === me || !w) confetti();
      mount(body, score,
        h('div', { class: 'card center result win' }, h('div', { class: 'big-emoji' }, w ? '🏆' : '🤝'),
          h('h2', {}, w ? `Vince ${s.names[w]}!` : 'Pareggio! Vi conoscete alla pari 💕')),
        h('div', { class: 'list' }, s.history.map((x) => h('div', { class: 'card small' },
          h('strong', {}, x.q),
          h('div', {}, `🗣️ ${s.names[x.who]}: ${x.answer}`),
          h('div', {}, `🔮 ${s.names[other(x.who)]}: ${x.guess}`),
          h('div', { class: 'muted' }, VERD[x.verdict]),
        ))),
        h('button', { class: 'btn primary big', onclick: () => session.dispatch({ type: 'restart' }) }, '🔁 Ancora'),
      );
      return;
    }

    const iAmSubject = s.subject === me;
    const qCard = h('div', { class: 'card question-card' },
      h('div', { class: 'muted small' }, iAmSubject ? 'Domanda su di te' : `Domanda su ${s.names[op]}`),
      h('h2', {}, q),
    );

    if (s.phase === 'answer') {
      const mine = iAmSubject ? s.answers.subject : s.answers.guess;
      if (mine) {
        mount(body, score, qCard, h('div', { class: 'card center' }, h('p', {}, '✅ Risposta inviata: ', h('strong', {}, mine)), h('p', { class: 'muted' }, `⏳ Aspetto ${s.names[op]}…`)));
        return;
      }
      const inp = h('textarea', { class: 'input', rows: 2, placeholder: iAmSubject ? 'La tua risposta sincera (segreta)…' : `Cosa risponderà ${s.names[op]}?`, maxlength: 300 });
      mount(body, score, qCard,
        h('form', { class: 'card stack', onsubmit: (e) => { e.preventDefault(); session.dispatch({ type: 'submit', text: inp.value }); } },
          inp,
          h('button', { class: 'btn primary' }, iAmSubject ? '🤫 Invia risposta' : '🔮 Invia ipotesi'),
          iAmSubject && !s.answers.guess ? h('button', { type: 'button', class: 'btn ghost small', onclick: () => session.dispatch({ type: 'skip' }) }, '🔀 Cambia domanda') : null,
        ),
      );
      return;
    }

    // reveal
    mount(body, score, qCard,
      h('div', { class: 'reveal-answers' },
        h('div', { class: 'card' }, h('div', { class: 'muted small' }, `${s.names[s.subject]} ha risposto`), h('h3', {}, s.answers.subject)),
        h('div', { class: 'card' }, h('div', { class: 'muted small' }, `${s.names[other(s.subject)]} ha ipotizzato`), h('h3', {}, s.answers.guess)),
      ),
      s.verdict == null
        ? (iAmSubject
          ? h('div', { class: 'stack' }, h('p', { class: 'center' }, 'Ha indovinato?'), h('div', { class: 'row' },
            h('button', { class: 'btn yes grow', onclick: () => session.dispatch({ type: 'judge', value: 'yes' }) }, '✅ Sì'),
            h('button', { class: 'btn grow', onclick: () => session.dispatch({ type: 'judge', value: 'half' }) }, '🤏 Quasi'),
            h('button', { class: 'btn no grow', onclick: () => session.dispatch({ type: 'judge', value: 'no' }) }, '❌ No')))
          : h('p', { class: 'muted center' }, `⏳ ${s.names[op]} sta giudicando…`))
        : h('div', { class: 'stack' }, h('div', { class: 'card center' }, h('h3', {}, VERD[s.verdict])),
          h('button', { class: 'btn primary big', onclick: () => session.dispatch({ type: 'next' }) }, s.round + 1 >= s.total ? 'Risultato finale 🏁' : 'Prossima domanda ➡️')),
    );
  };
  const off = session.on('state', draw);
  draw();
  return off;
}

export const quizGame = { id: 'quiz', title: 'Quanto mi conosci?', reducer, restoreAssets: async () => ({}), render };
