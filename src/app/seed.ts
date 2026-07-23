import { db } from '../db/db';
import {
  createArea, createHeading, createProject, createTag, createTask, completeTask,
} from '../db/mutations';
import {
  createBoard, createList, createCard, createLabel,
} from '../db/boardMutations';
import { addDays, todayStr } from '../domain/dates';

/** Demo dataset for previews and e2e tests. Idempotent: wipes first. */
export async function seedDemoData(): Promise<void> {
  await Promise.all(db.tables.map((t) => t.clear()));
  const today = todayStr();

  const errands = await createTag('Errand');
  const home = await createTag('Home');
  await createTag('15 min');

  const family = await createArea('Family');
  const work = await createArea('Work');

  const vacation = await createProject({ title: 'Vacation in Rome', areaId: family });
  const phase1 = await createHeading(vacation, 'Before we go');
  await createTask({ projectId: vacation, headingId: phase1, title: 'Book flights', startDate: today });
  await createTask({ projectId: vacation, headingId: phase1, title: 'Renew passports', deadline: addDays(today, 10) });
  const packed = await createTask({ projectId: vacation, headingId: phase1, title: 'Make packing list', tagIds: [home] });
  await completeTask(packed);
  await createTask({ projectId: vacation, title: 'Learn basic Italian', bucket: 'someday' });

  const launch = await createProject({ title: 'Website Launch', areaId: work, deadline: addDays(today, 14) });
  await createTask({ projectId: launch, title: 'Finish landing page', startDate: today });
  await createTask({ projectId: launch, title: 'Set up analytics', startDate: addDays(today, 2) });
  await createTask({ projectId: launch, title: 'Write announcement post', startDate: addDays(today, 9) });

  await createTask({ title: 'Buy groceries', startDate: today, bucket: 'anytime', tagIds: [errands] });
  await createTask({
    title: 'Water the plants',
    startDate: today,
    evening: true,
    bucket: 'anytime',
    checklist: [
      { id: 'c1', title: 'Living room', completed: true },
      { id: 'c2', title: 'Balcony', completed: false },
      { id: 'c3', title: 'Kitchen herbs', completed: false },
    ],
  });
  await createTask({ title: 'Call the dentist', deadline: addDays(today, -1), bucket: 'anytime' });
  await createTask({ title: 'Read “Deep Work”', bucket: 'someday', notes: 'Recommended by **Sam** - chapters 1-3 first' });
  await createTask({ title: 'New idea: balcony garden' });
  await createTask({ title: 'Check insurance offer' });
  await createTask({ title: 'Plan weekend hike', startDate: addDays(today, 3), bucket: 'anytime' });

  const oldDone = await createTask({ title: 'File taxes', bucket: 'anytime' });
  await completeTask(oldDone);
  const t = await db.tasks.get(oldDone);
  if (t) {
    await db.tasks.put({ ...t, completedAt: Date.now() - 3 * 86_400_000 });
  }

  // ---- Demo Kanban board ----------------------------------------------------
  const board = await createBoard({ title: 'Product Roadmap', color: 'var(--purple)' });
  const design = await createLabel(board, 'Design', 'var(--purple)');
  const bug = await createLabel(board, 'Bug', 'var(--red)');
  const feature = await createLabel(board, 'Feature', 'var(--green)');

  const todo = await createList(board, 'To Do');
  const doing = await createList(board, 'In Progress');
  const done = await createList(board, 'Done');

  await createCard(board, todo, {
    title: 'Design onboarding flow',
    labelIds: [design, feature],
    due: addDays(today, 4),
    checklist: [
      { id: 'k1', title: 'Wireframes', completed: true },
      { id: 'k2', title: 'Prototype', completed: false },
      { id: 'k3', title: 'Usability test', completed: false },
    ],
  });
  await createCard(board, todo, { title: 'Fix crash on empty search', labelIds: [bug], cover: 'var(--red)', due: addDays(today, -1) });
  await createCard(board, todo, { title: 'Write API docs' });

  await createCard(board, doing, {
    title: 'Dark mode polish',
    labelIds: [feature],
    description: 'Audit every screen for contrast in dark theme.',
    comments: [{ id: 'cm1', text: 'Started with the settings screen.', createdAt: Date.now() - 3_600_000 }],
  });
  await createCard(board, doing, { title: 'Reduce bundle size', labelIds: [feature], due: addDays(today, 2), dueTime: '15:00' });

  await createCard(board, done, { title: 'Ship v0.1', labelIds: [feature], cover: 'var(--green)', completed: true });
}
