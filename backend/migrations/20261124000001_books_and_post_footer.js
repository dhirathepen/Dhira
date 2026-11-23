'use strict';

/**
 * Replace the single book + updates timeline with a multi-book library, and
 * give posts a dedicated footer area for tags / related notes.
 */

const LEGACY_BOOK_COLUMNS = [
  'title',
  'subtitle',
  'introduction',
  'synopsis',
  'progress_percent',
  'progress_note',
  'status',
  'release_date',
  'cover_image_id',
  'created_at',
  'updated_at',
];

exports.up = async function up(knex) {
  const hasBookInfo = await knex.schema.hasTable('book_info');
  const hasBooks = await knex.schema.hasTable('books');

  if (!hasBooks) {
    await knex.schema.createTable('books', (table) => {
      table.increments('id').primary();
      table.string('title', 200).notNullable();
      table.string('subtitle', 300).notNullable().defaultTo('');
      table.text('introduction').notNullable().defaultTo('');
      table.text('synopsis').notNullable().defaultTo('');
      table.integer('progress_percent').notNullable().defaultTo(0);
      table.string('progress_note', 120).notNullable().defaultTo('');
      table
        .enu(
          'status',
          ['drafting', 'editing', 'with_editor', 'cover_design', 'preorder', 'published'],
          { useNative: false }
        )
        .notNullable()
        .defaultTo('drafting');
      table.date('release_date');
      table
        .integer('cover_image_id')
        .references('id')
        .inTable('images')
        .onDelete('SET NULL')
        .onUpdate('CASCADE');
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

      table.index(['status', 'release_date'], 'books_status_release_date_index');
      table.index(['created_at'], 'books_created_at_index');
    });
  }

  if (hasBookInfo) {
    const existing = await knex('book_info').orderBy('id', 'asc').select(LEGACY_BOOK_COLUMNS);
    if (existing.length) await knex('books').insert(existing);
  }

  if (await knex.schema.hasTable('book_updates')) {
    await knex.schema.dropTable('book_updates');
  }
  if (hasBookInfo) {
    await knex.schema.dropTable('book_info');
  }

  if (!(await knex.schema.hasColumn('posts', 'footer_note'))) {
    await knex.schema.alterTable('posts', (table) => {
      table.text('footer_note').notNullable().defaultTo('');
    });
  }
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasColumn('posts', 'footer_note'))) {
    await knex.schema.alterTable('posts', (table) => {
      table.text('footer_note').notNullable().defaultTo('');
    });
  }

  if (!(await knex.schema.hasTable('book_info'))) {
    await knex.schema.createTable('book_info', (table) => {
      table.integer('id').primary().defaultTo(1);
      table.string('title', 200).notNullable();
      table.string('subtitle', 300).notNullable().defaultTo('');
      table.text('introduction').notNullable().defaultTo('');
      table.text('synopsis').notNullable().defaultTo('');
      table.integer('progress_percent').notNullable().defaultTo(0);
      table.string('progress_note', 120).notNullable().defaultTo('');
      table
        .enu(
          'status',
          ['drafting', 'editing', 'with_editor', 'cover_design', 'preorder', 'published'],
          { useNative: false }
        )
        .notNullable()
        .defaultTo('drafting');
      table.date('release_date');
      table
        .integer('cover_image_id')
        .references('id')
        .inTable('images')
        .onDelete('SET NULL')
        .onUpdate('CASCADE');
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    });
  }

  if (!(await knex.schema.hasTable('book_updates'))) {
    await knex.schema.createTable('book_updates', (table) => {
      table.increments('id').primary();
      table.string('title', 250).notNullable();
      table.text('description').notNullable();
      table
        .integer('image_id')
        .references('id')
        .inTable('images')
        .onDelete('SET NULL')
        .onUpdate('CASCADE');
      table.date('update_date').notNullable();
      table
        .enu(
          'category',
          [
            'progress',
            'chapter',
            'cover_reveal',
            'milestone',
            'announcement',
            'release_date',
            'behind_the_scenes',
            'other',
          ],
          { useNative: false }
        )
        .notNullable()
        .defaultTo('progress');
      table.boolean('featured').notNullable().defaultTo(false);
      table.enu('status', ['draft', 'published'], { useNative: false }).notNullable().defaultTo('draft');
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
      table.index(['status', 'update_date'], 'book_updates_status_date_index');
      table.index(['status', 'featured'], 'book_updates_status_featured_index');
    });
  }

  if (await knex.schema.hasTable('books')) {
    const books = await knex('books').orderBy('id', 'asc').select(LEGACY_BOOK_COLUMNS);
    const first = books[0];
    if (first) {
      const alreadySeeded = await knex('book_info').where({ id: 1 }).first('id');
      if (!alreadySeeded) await knex('book_info').insert({ id: 1, ...first });
    }
    await knex.schema.dropTable('books');
  }

  await knex.schema.alterTable('posts', (table) => {
    table.dropColumn('footer_note');
  });
};
