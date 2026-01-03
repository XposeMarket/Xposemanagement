-- Migration: Create appointment_notes table
-- This adds multi-note support for appointments with full audit trail

create table appointment_notes (
  id uuid primary key default gen_random_uuid(),
  appointment_id text references appointments(id) on delete cascade not null,
  note text not null,
  created_by uuid references auth.users(id) not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

-- Index for fast lookups by appointment
create index idx_appointment_notes_appointment on appointment_notes(appointment_id);

-- Enable RLS
alter table appointment_notes enable row level security;

-- RLS Policy: Users can view notes for appointments in their shops
create policy "Users can view notes for appointments in their shops"
  on appointment_notes for select
  using (
    exists (
      select 1 from appointments a
      join shops s on a.shop_id = s.id
      join shop_staff ss on s.id = ss.shop_id
      where a.id = appointment_notes.appointment_id
      and ss.user_id = auth.uid()
    )
  );

-- RLS Policy: Users can create notes for appointments in their shops
create policy "Users can create notes for appointments in their shops"
  on appointment_notes for insert
  with check (
    exists (
      select 1 from appointments a
      join shops s on a.shop_id = s.id
      join shop_staff ss on s.id = ss.shop_id
      where a.id = appointment_notes.appointment_id
      and ss.user_id = auth.uid()
    )
  );

-- RLS Policy: Users can update notes for appointments in their shops
create policy "Users can update notes for appointments in their shops"
  on appointment_notes for update
  using (
    exists (
      select 1 from appointments a
      join shops s on a.shop_id = s.id
      join shop_staff ss on s.id = ss.shop_id
      where a.id = appointment_notes.appointment_id
      and ss.user_id = auth.uid()
    )
  );

-- RLS Policy: Users can delete notes for appointments in their shops
create policy "Users can delete notes for appointments in their shops"
  on appointment_notes for delete
  using (
    exists (
      select 1 from appointments a
      join shops s on a.shop_id = s.id
      join shop_staff ss on s.id = ss.shop_id
      where a.id = appointment_notes.appointment_id
      and ss.user_id = auth.uid()
    )
  );

-- Create function to automatically update updated_at timestamp
create or replace function update_appointment_note_timestamp()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Add trigger to update updated_at on note updates
create trigger update_appointment_note_timestamp
  before update on appointment_notes
  for each row
  execute function update_appointment_note_timestamp();
