import type { DateStr } from '../db/models';
import { daysBetween } from './dates';

/** The daily quote: one line about the brain and how to make it better,
 *  shipped with the app rather than fetched.
 *
 *  Two decisions worth stating. First, the library is *bundled*: a quote that
 *  needs the network is a quote you don't get on the train, and an app whose
 *  whole promise is "your data never leaves your device" shouldn't phone out
 *  for a sentence. Second, attributions are conservative. A quote feature that
 *  misattributes is worse than no quote feature, so anything popularly pinned
 *  to a name without a traceable text is flagged `attributed` and the UI says
 *  "attributed to" rather than pretending. */

export type QuoteTopic =
  | 'plasticity'
  | 'attention'
  | 'habit'
  | 'learning'
  | 'memory'
  | 'sleep'
  | 'movement'
  | 'emotion'
  | 'belief'
  | 'rest';

export interface BrainQuote {
  /** Stable slug. Favourites and cached AI notes are keyed by it, so it must
   *  never be recycled for a different quote. */
  id: string;
  text: string;
  author: string;
  /** The work it comes from, where one is known. */
  source?: string;
  /** Popularly attributed, not traceable to a primary text. */
  attributed?: boolean;
  topic: QuoteTopic;
}

export const TOPIC_LABEL: Record<QuoteTopic, string> = {
  plasticity: 'Neuroplasticity',
  attention: 'Attention',
  habit: 'Habit',
  learning: 'Learning',
  memory: 'Memory',
  sleep: 'Sleep',
  movement: 'Movement',
  emotion: 'Emotion',
  belief: 'Belief',
  rest: 'Rest',
};

export const TOPIC_COLOR: Record<QuoteTopic, string> = {
  plasticity: 'var(--purple)',
  attention: 'var(--blue)',
  habit: 'var(--green)',
  learning: 'var(--teal)',
  memory: 'var(--tan)',
  sleep: 'var(--purple)',
  movement: 'var(--green)',
  emotion: 'var(--red)',
  belief: 'var(--yellow-deep)',
  rest: 'var(--teal)',
};

export const QUOTES: BrainQuote[] = [
  // ---- the brain changes itself ------------------------------------------
  {
    id: 'cajal-sculptor',
    text: 'Every man can, if he so desires, become the sculptor of his own brain.',
    author: 'Santiago Ramón y Cajal',
    source: 'Advice for a Young Investigator',
    topic: 'plasticity',
  },
  {
    id: 'cajal-mystery',
    text: 'As long as our brain is a mystery, the universe, the reflection of the structure of the brain, will also be a mystery.',
    author: 'Santiago Ramón y Cajal',
    topic: 'plasticity',
  },
  {
    id: 'james-ally',
    text: 'The great thing, then, in all education, is to make our nervous system our ally instead of our enemy.',
    author: 'William James',
    source: 'The Principles of Psychology',
    topic: 'habit',
  },
  {
    id: 'james-plastic-state',
    text: 'Could the young but realize how soon they will become mere walking bundles of habits, they would give more heed to their conduct while in the plastic state.',
    author: 'William James',
    source: 'The Principles of Psychology',
    topic: 'habit',
  },
  {
    id: 'james-plasticity',
    text: 'Plasticity means the possession of a structure weak enough to yield to an influence, but strong enough not to yield all at once.',
    author: 'William James',
    source: 'The Principles of Psychology',
    topic: 'plasticity',
  },
  {
    id: 'james-attend',
    text: 'My experience is what I agree to attend to.',
    author: 'William James',
    source: 'The Principles of Psychology',
    topic: 'attention',
  },
  {
    id: 'james-what-attention-is',
    text: 'Everyone knows what attention is. It is the taking possession by the mind, in clear and vivid form, of one out of what seem several simultaneously possible objects or trains of thought.',
    author: 'William James',
    source: 'The Principles of Psychology',
    topic: 'attention',
  },
  {
    id: 'hebb-associated',
    text: 'Any two cells or systems of cells that are repeatedly active at the same time will tend to become associated, so that activity in one facilitates activity in the other.',
    author: 'Donald Hebb',
    source: 'The Organization of Behavior',
    topic: 'plasticity',
  },
  {
    id: 'shatz-fire-wire',
    text: 'Cells that fire together wire together.',
    author: 'Carla Shatz',
    source: 'her summary of Hebb’s rule',
    topic: 'plasticity',
  },
  {
    id: 'doidge-plastic-paradox',
    text: 'The same neuroplastic properties that allow us to change our brains and produce more flexible behaviours can also allow us to produce more rigid ones.',
    author: 'Norman Doidge',
    source: 'The Brain That Changes Itself',
    topic: 'plasticity',
  },
  {
    id: 'merzenich-attention',
    text: 'Experience coupled with attention leads to physical changes in the structure and future functioning of the nervous system.',
    author: 'Michael Merzenich',
    topic: 'plasticity',
  },
  {
    id: 'merzenich-sculpt',
    text: 'You choose and sculpt how your ever-changing mind will work. You choose who you will be the next moment in a very real sense, and these choices are left embossed in physical form on your material self.',
    author: 'Michael Merzenich',
    source: 'Soft-Wired',
    topic: 'plasticity',
  },
  {
    id: 'kandel-who-we-are',
    text: 'We are who we are because of what we learn and what we remember.',
    author: 'Eric Kandel',
    source: 'In Search of Memory',
    topic: 'memory',
  },
  {
    id: 'bach-y-rita-see-with-brains',
    text: 'We see with our brains, not with our eyes.',
    author: 'Paul Bach-y-Rita',
    topic: 'plasticity',
  },
  {
    id: 'ramachandran-jelly',
    text: 'Here is this mass of jelly you can hold in the palm of your hand, and it can contemplate the vastness of interstellar space.',
    author: 'V. S. Ramachandran',
    topic: 'plasticity',
  },
  {
    id: 'eagleman-vault',
    text: 'Your brain is locked in a vault of silence and darkness inside your skull. All it ever sees are electrochemical signals.',
    author: 'David Eagleman',
    source: 'Livewired',
    topic: 'plasticity',
  },
  {
    id: 'eagleman-stowaway',
    text: 'Your consciousness is like a tiny stowaway on a transatlantic steamship, taking credit for the journey without acknowledging the massive engineering underfoot.',
    author: 'David Eagleman',
    source: 'Incognito',
    topic: 'plasticity',
  },
  {
    id: 'diamond-use-it',
    text: 'Use it or lose it.',
    author: 'Marian Diamond',
    source: 'on enriched environments',
    attributed: true,
    topic: 'plasticity',
  },
  {
    id: 'levi-montalcini-difficult',
    text: 'Above all, don’t fear difficult moments. The best comes from them.',
    author: 'Rita Levi-Montalcini',
    topic: 'belief',
  },
  {
    id: 'sacks-narrative',
    text: 'We have, each of us, a life-story, an inner narrative — whose continuity, whose sense, is our lives.',
    author: 'Oliver Sacks',
    source: 'The Man Who Mistook His Wife for a Hat',
    topic: 'memory',
  },
  {
    id: 'sacks-music',
    text: 'Music can lift us out of depression or move us to tears — it is a remedy, a tonic, orange juice for the ear.',
    author: 'Oliver Sacks',
    source: 'Musicophilia',
    topic: 'emotion',
  },

  // ---- attention ----------------------------------------------------------
  {
    id: 'weil-attention',
    text: 'Attention is the rarest and purest form of generosity.',
    author: 'Simone Weil',
    topic: 'attention',
  },
  {
    id: 'oliver-devotion',
    text: 'Attention is the beginning of devotion.',
    author: 'Mary Oliver',
    source: 'Upstream',
    topic: 'attention',
  },
  {
    id: 'dillard-days',
    text: 'How we spend our days is, of course, how we spend our lives.',
    author: 'Annie Dillard',
    source: 'The Writing Life',
    topic: 'attention',
  },
  {
    id: 'simon-poverty',
    text: 'A wealth of information creates a poverty of attention.',
    author: 'Herbert Simon',
    topic: 'attention',
  },
  {
    id: 'newport-clarity',
    text: 'Clarity about what matters provides clarity about what does not.',
    author: 'Cal Newport',
    source: 'Deep Work',
    topic: 'attention',
  },
  {
    id: 'newport-superpower',
    text: 'Deep work is like a superpower in our increasingly competitive twenty-first-century economy.',
    author: 'Cal Newport',
    source: 'Deep Work',
    topic: 'attention',
  },
  {
    id: 'gallagher-sum-of-focus',
    text: 'Who you are, what you think, feel, and do, what you love — is the sum of what you focus on.',
    author: 'Winifred Gallagher',
    source: 'Rapt',
    topic: 'attention',
  },
  {
    id: 'goleman-muscle',
    text: 'Attention works much like a muscle — use it poorly and it can wither; work it well and it grows.',
    author: 'Daniel Goleman',
    source: 'Focus',
    topic: 'attention',
  },
  {
    id: 'eyal-forethought',
    text: 'The antidote to impulsiveness is forethought.',
    author: 'Nir Eyal',
    source: 'Indistractable',
    topic: 'attention',
  },
  {
    id: 'hari-stolen',
    text: 'Your attention didn’t collapse. It was stolen.',
    author: 'Johann Hari',
    source: 'Stolen Focus',
    topic: 'attention',
  },
  {
    id: 'carr-interruption',
    text: 'The Net is designed to be an interruption system, a machine geared for dividing attention.',
    author: 'Nicholas Carr',
    source: 'The Shallows',
    topic: 'attention',
  },
  {
    id: 'carr-chipping',
    text: 'What the Net seems to be doing is chipping away my capacity for concentration and contemplation.',
    author: 'Nicholas Carr',
    source: 'The Shallows',
    topic: 'attention',
  },
  {
    id: 'mcgilchrist-moral-act',
    text: 'Attention is a moral act: it creates, brings aspects of things into being.',
    author: 'Iain McGilchrist',
    source: 'The Master and His Emissary',
    topic: 'attention',
  },
  {
    id: 'levitin-resource',
    text: 'Attention is the most essential mental resource for any organism.',
    author: 'Daniel Levitin',
    source: 'The Organized Mind',
    topic: 'attention',
  },
  {
    id: 'pascal-room-alone',
    text: 'All of humanity’s problems stem from man’s inability to sit quietly in a room alone.',
    author: 'Blaise Pascal',
    source: 'Pensées',
    topic: 'attention',
  },

  // ---- habit --------------------------------------------------------------
  {
    id: 'durant-excellence',
    text: 'We are what we repeatedly do. Excellence, then, is not an act, but a habit.',
    author: 'Will Durant',
    source: 'The Story of Philosophy, summarising Aristotle',
    topic: 'habit',
  },
  {
    id: 'aristotle-moral-excellence',
    text: 'Moral excellence comes about as a result of habit. We become just by doing just acts, temperate by doing temperate acts, brave by doing brave acts.',
    author: 'Aristotle',
    source: 'Nicomachean Ethics',
    topic: 'habit',
  },
  {
    id: 'clear-systems',
    text: 'You do not rise to the level of your goals. You fall to the level of your systems.',
    author: 'James Clear',
    source: 'Atomic Habits',
    topic: 'habit',
  },
  {
    id: 'clear-vote',
    text: 'Every action you take is a vote for the type of person you wish to become.',
    author: 'James Clear',
    source: 'Atomic Habits',
    topic: 'belief',
  },
  {
    id: 'clear-compound',
    text: 'Habits are the compound interest of self-improvement.',
    author: 'James Clear',
    source: 'Atomic Habits',
    topic: 'habit',
  },
  {
    id: 'duhigg-champions',
    text: 'Champions don’t do extraordinary things. They do ordinary things, but they do them without thinking, too fast for the other team to react.',
    author: 'Charles Duhigg',
    source: 'The Power of Habit',
    topic: 'habit',
  },
  {
    id: 'duhigg-not-destiny',
    text: 'Habits are not destiny.',
    author: 'Charles Duhigg',
    source: 'The Power of Habit',
    topic: 'habit',
  },
  {
    id: 'fogg-emotions',
    text: 'Emotions create habits.',
    author: 'BJ Fogg',
    source: 'Tiny Habits',
    topic: 'habit',
  },
  {
    id: 'ebbinghaus-spacing',
    text: 'With any considerable number of repetitions a suitable distribution of them over a space of time is decidedly more advantageous than the massing of them at a single time.',
    author: 'Hermann Ebbinghaus',
    source: 'Memory (1885)',
    topic: 'learning',
  },

  // ---- learning and practice ---------------------------------------------
  {
    id: 'ericsson-comfort-zone',
    text: 'If you never push yourself beyond your comfort zone, you will never improve.',
    author: 'Anders Ericsson',
    source: 'Peak',
    topic: 'learning',
  },
  {
    id: 'ericsson-different-direction',
    text: 'The best way to get past any barrier is to come at it from a different direction.',
    author: 'Anders Ericsson',
    source: 'Peak',
    topic: 'learning',
  },
  {
    id: 'oakley-chunking',
    text: 'Chunking is the mental leap that helps you unite bits of information together through meaning.',
    author: 'Barbara Oakley',
    source: 'A Mind for Numbers',
    topic: 'learning',
  },
  {
    id: 'dweck-becoming',
    text: 'Becoming is better than being.',
    author: 'Carol Dweck',
    source: 'Mindset',
    topic: 'belief',
  },
  {
    id: 'dweck-view-you-adopt',
    text: 'The view you adopt for yourself profoundly affects the way you lead your life.',
    author: 'Carol Dweck',
    source: 'Mindset',
    topic: 'belief',
  },
  {
    id: 'dweck-effort-ignites',
    text: 'No matter what your ability is, effort is what ignites that ability and turns it into accomplishment.',
    author: 'Carol Dweck',
    source: 'Mindset',
    topic: 'belief',
  },
  {
    id: 'duckworth-endurance',
    text: 'Enthusiasm is common. Endurance is rare.',
    author: 'Angela Duckworth',
    source: 'Grit',
    topic: 'belief',
  },
  {
    id: 'duckworth-grit',
    text: 'Grit is passion and perseverance for very long-term goals.',
    author: 'Angela Duckworth',
    source: 'Grit',
    topic: 'belief',
  },
  {
    id: 'piaget-intelligence',
    text: 'Intelligence is what you use when you don’t know what to do.',
    author: 'Jean Piaget',
    topic: 'learning',
  },
  {
    id: 'vygotsky-assistance',
    text: 'What a child can do with assistance today, she will be able to do by herself tomorrow.',
    author: 'Lev Vygotsky',
    source: 'Mind in Society',
    topic: 'learning',
  },
  {
    id: 'montessori-as-if',
    text: 'The greatest sign of success for a teacher is to be able to say, “The children are now working as if I did not exist.”',
    author: 'Maria Montessori',
    topic: 'learning',
  },
  {
    id: 'confucius-do',
    text: 'I hear and I forget. I see and I remember. I do and I understand.',
    author: 'Confucius',
    attributed: true,
    topic: 'learning',
  },
  {
    id: 'feynman-fool-yourself',
    text: 'The first principle is that you must not fool yourself — and you are the easiest person to fool.',
    author: 'Richard Feynman',
    topic: 'learning',
  },
  {
    id: 'feynman-create',
    text: 'What I cannot create, I do not understand.',
    author: 'Richard Feynman',
    topic: 'learning',
  },
  {
    id: 'curie-understood',
    text: 'Nothing in life is to be feared, it is only to be understood. Now is the time to understand more, so that we may fear less.',
    author: 'Marie Curie',
    topic: 'learning',
  },
  {
    id: 'adler-express',
    text: 'The person who says he knows what he thinks but cannot express it usually does not know what he thinks.',
    author: 'Mortimer Adler',
    source: 'How to Read a Book',
    topic: 'learning',
  },
  {
    id: 'seneca-teach-learn',
    text: 'While we teach, we learn.',
    author: 'Seneca',
    source: 'Letters to Lucilius',
    topic: 'learning',
  },
  {
    id: 'munger-other-side',
    text: 'I never allow myself to have an opinion on anything that I don’t know the other side’s argument better than they do.',
    author: 'Charlie Munger',
    topic: 'learning',
  },
  {
    id: 'munger-voracious',
    text: 'Develop into a lifelong self-learner through voracious reading.',
    author: 'Charlie Munger',
    topic: 'learning',
  },
  {
    id: 'murakami-everyone-reads',
    text: 'If you only read the books that everyone else is reading, you can only think what everyone else is thinking.',
    author: 'Haruki Murakami',
    source: 'Norwegian Wood',
    topic: 'learning',
  },
  {
    id: 'king-read',
    text: 'If you don’t have time to read, you don’t have the time — or the tools — to write.',
    author: 'Stephen King',
    source: 'On Writing',
    topic: 'learning',
  },
  {
    id: 'addison-reading-exercise',
    text: 'Reading is to the mind what exercise is to the body.',
    author: 'Joseph Addison',
    topic: 'learning',
  },
  {
    id: 'schopenhauer-field-of-vision',
    text: 'Every man takes the limits of his own field of vision for the limits of the world.',
    author: 'Arthur Schopenhauer',
    topic: 'belief',
  },
  {
    id: 'wittgenstein-language-limits',
    text: 'The limits of my language mean the limits of my world.',
    author: 'Ludwig Wittgenstein',
    source: 'Tractatus Logico-Philosophicus',
    topic: 'learning',
  },
  {
    id: 'didion-find-out',
    text: 'I write entirely to find out what I’m thinking.',
    author: 'Joan Didion',
    topic: 'learning',
  },
  {
    id: 'oconnor-read-what-i-say',
    text: 'I write because I don’t know what I think until I read what I say.',
    author: 'Flannery O’Connor',
    topic: 'learning',
  },
  {
    id: 'forster-see-what-i-say',
    text: 'How do I know what I think until I see what I say?',
    author: 'E. M. Forster',
    source: 'Aspects of the Novel',
    topic: 'learning',
  },

  // ---- memory -------------------------------------------------------------
  {
    id: 'tulving-time-travel',
    text: 'Episodic memory makes possible mental time travel through subjective time.',
    author: 'Endel Tulving',
    topic: 'memory',
  },
  {
    id: 'loftus-fragile',
    text: 'Memory, like liberty, is a fragile thing.',
    author: 'Elizabeth Loftus',
    topic: 'memory',
  },
  {
    id: 'schacter-records',
    text: 'Memories are records of how we have experienced events, not replicas of the events themselves.',
    author: 'Daniel Schacter',
    source: 'Searching for Memory',
    topic: 'memory',
  },
  {
    id: 'proust-new-eyes',
    text: 'The real voyage of discovery consists not in seeking new landscapes, but in having new eyes.',
    author: 'Marcel Proust',
    topic: 'memory',
  },
  {
    id: 'nietzsche-memory-yields',
    text: '“I have done that,” says my memory. “I cannot have done that,” says my pride, and remains inexorable. Eventually — memory yields.',
    author: 'Friedrich Nietzsche',
    source: 'Beyond Good and Evil',
    topic: 'memory',
  },

  // ---- sleep --------------------------------------------------------------
  {
    id: 'walker-reset',
    text: 'Sleep is the single most effective thing we can do to reset our brain and body health each day.',
    author: 'Matthew Walker',
    source: 'Why We Sleep',
    topic: 'sleep',
  },
  {
    id: 'walker-shorter-life',
    text: 'The shorter your sleep, the shorter your life span.',
    author: 'Matthew Walker',
    source: 'Why We Sleep',
    topic: 'sleep',
  },
  {
    id: 'walker-practice-sleep',
    text: 'Practice does not make perfect. It is practice, followed by a night of sleep, that leads to perfection.',
    author: 'Matthew Walker',
    source: 'Why We Sleep',
    topic: 'sleep',
  },
  {
    id: 'dekker-golden-chain',
    text: 'Sleep is that golden chain that ties health and our bodies together.',
    author: 'Thomas Dekker',
    topic: 'sleep',
  },
  {
    id: 'steinbeck-committee-of-sleep',
    text: 'It is a common experience that a problem difficult at night is resolved in the morning after the committee of sleep has worked on it.',
    author: 'John Steinbeck',
    topic: 'sleep',
  },

  // ---- movement -----------------------------------------------------------
  {
    id: 'ratey-single-most-powerful',
    text: 'Exercise is the single most powerful tool you have to optimize your brain function.',
    author: 'John Ratey',
    source: 'Spark',
    topic: 'movement',
  },
  {
    id: 'ratey-miracle-gro',
    text: 'BDNF is Miracle-Gro for the brain.',
    author: 'John Ratey',
    source: 'Spark',
    topic: 'movement',
  },
  {
    id: 'suzuki-bubble-bath',
    text: 'Every time you move your body, you give your brain a bubble bath of neurochemicals.',
    author: 'Wendy Suzuki',
    topic: 'movement',
  },
  {
    id: 'jefferson-strong-body',
    text: 'A strong body makes the mind strong.',
    author: 'Thomas Jefferson',
    topic: 'movement',
  },
  {
    id: 'nietzsche-walking-thoughts',
    text: 'All truly great thoughts are conceived while walking.',
    author: 'Friedrich Nietzsche',
    source: 'Twilight of the Idols',
    topic: 'movement',
  },
  {
    id: 'thoreau-legs-move',
    text: 'The moment my legs begin to move, my thoughts begin to flow.',
    author: 'Henry David Thoreau',
    topic: 'movement',
  },
  {
    id: 'hippocrates-walking',
    text: 'Walking is man’s best medicine.',
    author: 'Hippocrates',
    attributed: true,
    topic: 'movement',
  },
  {
    id: 'pollan-eat-food',
    text: 'Eat food. Not too much. Mostly plants.',
    author: 'Michael Pollan',
    source: 'In Defense of Food',
    topic: 'movement',
  },

  // ---- emotion and stress -------------------------------------------------
  {
    id: 'frankl-last-freedom',
    text: 'Everything can be taken from a man but one thing: the last of the human freedoms — to choose one’s attitude in any given set of circumstances.',
    author: 'Viktor Frankl',
    source: 'Man’s Search for Meaning',
    topic: 'emotion',
  },
  {
    id: 'frankl-change-ourselves',
    text: 'When we are no longer able to change a situation, we are challenged to change ourselves.',
    author: 'Viktor Frankl',
    source: 'Man’s Search for Meaning',
    topic: 'emotion',
  },
  {
    id: 'frankl-space',
    text: 'Between stimulus and response there is a space. In that space is our power to choose our response.',
    author: 'Viktor Frankl',
    attributed: true,
    topic: 'emotion',
  },
  {
    id: 'barrett-not-at-mercy',
    text: 'You are not at the mercy of mythical emotion circuits buried deep within your brain. Your brain constructs emotions.',
    author: 'Lisa Feldman Barrett',
    source: 'How Emotions Are Made',
    topic: 'emotion',
  },
  {
    id: 'barrett-running-your-body',
    text: 'Your brain’s most important job is not thinking; it’s running your body.',
    author: 'Lisa Feldman Barrett',
    source: 'Seven and a Half Lessons About the Brain',
    topic: 'emotion',
  },
  {
    id: 'damasio-feeling-machines',
    text: 'We are not thinking machines that feel; rather, we are feeling machines that think.',
    author: 'Antonio Damasio',
    topic: 'emotion',
  },
  {
    id: 'sapolsky-zebras',
    text: 'Stress-related disease emerges because we activate a system evolved for acute physical emergencies for months on end, worrying about mortgages, relationships and promotions.',
    author: 'Robert Sapolsky',
    source: 'Why Zebras Don’t Get Ulcers',
    topic: 'emotion',
  },
  {
    id: 'hanson-velcro',
    text: 'The brain is like Velcro for negative experiences but Teflon for positive ones.',
    author: 'Rick Hanson',
    source: 'Hardwiring Happiness',
    topic: 'emotion',
  },
  {
    id: 'kabat-zinn-surf',
    text: 'You can’t stop the waves, but you can learn to surf.',
    author: 'Jon Kabat-Zinn',
    topic: 'emotion',
  },
  {
    id: 'kabat-zinn-mindfulness',
    text: 'Mindfulness means paying attention in a particular way: on purpose, in the present moment, and non-judgmentally.',
    author: 'Jon Kabat-Zinn',
    source: 'Wherever You Go, There You Are',
    topic: 'attention',
  },
  {
    id: 'nhat-hanh-anchor',
    text: 'Feelings come and go like clouds in a windy sky. Conscious breathing is my anchor.',
    author: 'Thich Nhat Hanh',
    topic: 'emotion',
  },
  {
    id: 'mcgonigal-change-your-mind',
    text: 'When you change your mind about stress, you can change your body’s response to stress.',
    author: 'Kelly McGonigal',
    source: 'The Upside of Stress',
    topic: 'emotion',
  },
  {
    id: 'taleb-wind-candle',
    text: 'Wind extinguishes a candle and energizes fire.',
    author: 'Nassim Nicholas Taleb',
    source: 'Antifragile',
    topic: 'emotion',
  },
  {
    id: 'seneca-imagination',
    text: 'We suffer more often in imagination than in reality.',
    author: 'Seneca',
    source: 'Letters to Lucilius',
    topic: 'emotion',
  },
  {
    id: 'seneca-difficulties',
    text: 'Difficulties strengthen the mind, as labour does the body.',
    author: 'Seneca',
    topic: 'emotion',
  },
  {
    id: 'montaigne-misfortunes',
    text: 'My life has been full of terrible misfortunes, most of which never happened.',
    author: 'Michel de Montaigne',
    attributed: true,
    topic: 'emotion',
  },
  {
    id: 'epictetus-views',
    text: 'Men are disturbed not by things, but by the views which they take of things.',
    author: 'Epictetus',
    source: 'Enchiridion',
    topic: 'belief',
  },
  {
    id: 'epictetus-master-of-himself',
    text: 'No man is free who is not master of himself.',
    author: 'Epictetus',
    topic: 'belief',
  },
  {
    id: 'aurelius-power-over-mind',
    text: 'You have power over your mind — not outside events. Realize this, and you will find strength.',
    author: 'Marcus Aurelius',
    source: 'Meditations',
    topic: 'belief',
  },
  {
    id: 'aurelius-dyed',
    text: 'The soul becomes dyed with the colour of its thoughts.',
    author: 'Marcus Aurelius',
    source: 'Meditations',
    topic: 'belief',
  },
  {
    id: 'aurelius-obstacle',
    text: 'The impediment to action advances action. What stands in the way becomes the way.',
    author: 'Marcus Aurelius',
    source: 'Meditations',
    topic: 'belief',
  },
  {
    id: 'murakami-pain-suffering',
    text: 'Pain is inevitable. Suffering is optional.',
    author: 'Haruki Murakami',
    source: 'What I Talk About When I Talk About Running',
    topic: 'belief',
  },

  // ---- belief and identity ------------------------------------------------
  {
    id: 'ford-think-you-can',
    text: 'Whether you think you can, or you think you can’t — you’re right.',
    author: 'Henry Ford',
    attributed: true,
    topic: 'belief',
  },
  {
    id: 'angelou-change-attitude',
    text: 'If you don’t like something, change it. If you can’t change it, change your attitude.',
    author: 'Maya Angelou',
    topic: 'belief',
  },
  {
    id: 'angelou-nothing-will-work',
    text: 'Nothing will work unless you do.',
    author: 'Maya Angelou',
    topic: 'belief',
  },
  {
    id: 'hill-conceive-believe',
    text: 'Whatever the mind can conceive and believe, it can achieve.',
    author: 'Napoleon Hill',
    source: 'Think and Grow Rich',
    topic: 'belief',
  },
  {
    id: 'dhammapada-we-are-what-we-think',
    text: 'We are what we think. All that we are arises with our thoughts. With our thoughts we make the world.',
    author: 'The Dhammapada',
    topic: 'belief',
  },
  {
    id: 'laozi-watch-your-thoughts',
    text: 'Watch your thoughts, they become your words; watch your words, they become your actions; watch your actions, they become your habits; watch your habits, they become your character.',
    author: 'Lao Tzu',
    attributed: true,
    topic: 'belief',
  },
  {
    id: 'emerson-trust-thyself',
    text: 'Trust thyself: every heart vibrates to that iron string.',
    author: 'Ralph Waldo Emerson',
    source: 'Self-Reliance',
    topic: 'belief',
  },
  {
    id: 'emerson-decide-to-be',
    text: 'The only person you are destined to become is the person you decide to be.',
    author: 'Ralph Waldo Emerson',
    attributed: true,
    topic: 'belief',
  },
  {
    id: 'douglass-strong-children',
    text: 'It is easier to build strong children than to repair broken men.',
    author: 'Frederick Douglass',
    attributed: true,
    topic: 'belief',
  },
  {
    id: 'mandela-impossible',
    text: 'It always seems impossible until it’s done.',
    author: 'Nelson Mandela',
    topic: 'belief',
  },
  {
    id: 'hooks-imagine-possible',
    text: 'The function of art is to do more than tell it like it is — it’s to imagine what is possible.',
    author: 'bell hooks',
    topic: 'belief',
  },
  {
    id: 'morrison-write-it',
    text: 'If there’s a book that you want to read, but it hasn’t been written yet, then you must write it.',
    author: 'Toni Morrison',
    topic: 'belief',
  },

  // ---- thinking and judgement --------------------------------------------
  {
    id: 'kahneman-focusing-illusion',
    text: 'Nothing in life is as important as you think it is, while you are thinking about it.',
    author: 'Daniel Kahneman',
    source: 'Thinking, Fast and Slow',
    topic: 'attention',
  },
  {
    id: 'kahneman-repetition',
    text: 'A reliable way to make people believe in falsehoods is frequent repetition, because familiarity is not easily distinguished from truth.',
    author: 'Daniel Kahneman',
    source: 'Thinking, Fast and Slow',
    topic: 'belief',
  },
  {
    id: 'kahneman-blind-to-blindness',
    text: 'We can be blind to the obvious, and we are also blind to our blindness.',
    author: 'Daniel Kahneman',
    source: 'Thinking, Fast and Slow',
    topic: 'belief',
  },

  // ---- rest and recovery --------------------------------------------------
  {
    id: 'davinci-go-away',
    text: 'Every now and then go away, have a little relaxation, for when you come back to your work your judgement will be surer.',
    author: 'Leonardo da Vinci',
    topic: 'rest',
  },
  {
    id: 'poincare-ideas-collide',
    text: 'Ideas rose in crowds; I felt them collide until pairs interlocked, so to speak, making a stable combination.',
    author: 'Henri Poincaré',
    source: 'Science and Method',
    topic: 'rest',
  },
  {
    id: 'russell-boredom',
    text: 'A generation that cannot endure boredom will be a generation of little men.',
    author: 'Bertrand Russell',
    source: 'The Conquest of Happiness',
    topic: 'rest',
  },
  {
    id: 'russell-wasting-time',
    text: 'The time you enjoy wasting is not wasted time.',
    author: 'Bertrand Russell',
    attributed: true,
    topic: 'rest',
  },
];

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** A step through the library that is coprime with its length, so day after
 *  day walks the whole shelf before repeating anything — and never lands on
 *  two neighbours in a row, which a step of 1 would. */
export function strideFor(length: number): number {
  if (length <= 2) return 1;
  let stride = Math.max(2, Math.round(length * 0.382));
  while (gcd(stride, length) !== 1) stride++;
  return stride;
}

const EPOCH = '1970-01-01';

/** Which quote today gets. Deterministic in the date alone: the same day shows
 *  the same quote on every device, all day, with nothing stored. */
export function quoteIndexFor(date: DateStr, length: number): number {
  if (length <= 0) return -1;
  const day = daysBetween(EPOCH, date);
  const raw = (day * strideFor(length)) % length;
  return raw < 0 ? raw + length : raw;
}

export function quoteForDate(date: DateStr, quotes: BrainQuote[] = QUOTES): BrainQuote | null {
  const i = quoteIndexFor(date, quotes.length);
  return i < 0 ? null : quotes[i]!;
}

export function quoteById(id: string, quotes: BrainQuote[] = QUOTES): BrainQuote | null {
  return quotes.find((q) => q.id === id) ?? null;
}

/** How the attribution reads under the quote. */
export function attribution(quote: BrainQuote): string {
  const name = quote.attributed ? `attributed to ${quote.author}` : quote.author;
  return quote.source ? `${name} · ${quote.source}` : name;
}

/** The prompt behind "Go deeper" — the same text whether it is answered in
 *  place through the user's key or handed off to the Claude app. */
export function deeperPrompt(quote: BrainQuote): string {
  return [
    'Here is a quote I am sitting with today:',
    '',
    `"${quote.text}"`,
    `— ${attribution(quote)}`,
    '',
    'In about 150 words, and in plain language:',
    '1. What does modern neuroscience actually say about the claim behind this line? Say plainly if the science is thin or contested.',
    '2. Give me one concrete thing I could do today, in under ten minutes, that puts it into practice.',
    'Skip the preamble and do not repeat the quote back to me.',
  ].join('\n');
}
