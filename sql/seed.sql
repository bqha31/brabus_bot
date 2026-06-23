-- Seed data for barbershop bot
-- NOTE: duration_minutes values are reasonable estimates, not provided by the
-- business owner. Adjust them in Supabase (table editor or SQL) if real
-- service times differ — this directly affects how many slots fit per day.

INSERT INTO barbers (name, sort_order) VALUES
  ('Бейбарс', 1),
  ('Досжан', 2)
ON CONFLICT (name) DO UPDATE SET
  sort_order = EXCLUDED.sort_order,
  is_active = TRUE;

INSERT INTO services (name, category, duration_minutes, price, sort_order) VALUES
  ('Мужская стрижка', 'individual', 45, 8000, 1),
  ('Детская стрижка (от 5 до 13 лет)', 'individual', 40, 7000, 2),
  ('Моделирование бороды', 'individual', 30, 5000, 3),
  ('Удлиненная стрижка (ножницами)', 'individual', 60, 9000, 4),
  ('Стрижка под насадку', 'individual', 30, 5000, 5),
  ('Тонирование седины', 'individual', 45, 8000, 6),
  ('Тонирование бороды', 'individual', 30, 5000, 7),
  ('Классическое бритье', 'individual', 30, 5000, 8),
  ('Бритье головы', 'individual', 30, 7000, 9),
  ('Бритье шейвером (электробритвой)', 'individual', 20, 3000, 10),
  ('Окантовка краевой линии', 'individual', 15, 4000, 11),
  ('Удаление воском (нос/уши)', 'individual', 15, 1000, 12),
  ('Отец + сын', 'complex', 75, 12000, 1),
  ('Отец + два сына', 'complex', 105, 16000, 2),
  ('Сын + сын', 'complex', 75, 11000, 3),
  ('Мужская стрижка + борода', 'complex', 75, 11000, 4),
  ('Мужская стрижка + тонирование седины', 'complex', 90, 14000, 5),
  ('Мужская стрижка + бритье', 'complex', 75, 11000, 6),
  ('Мужская стрижка + маска', 'complex', 75, 11000, 7),
  ('Мужская стрижка + борода + маска', 'complex', 90, 14000, 8),
  ('Мужская стрижка + удаление воском', 'complex', 60, 9000, 9),
  ('Стрижка под машинку + борода', 'complex', 60, 8000, 10);
