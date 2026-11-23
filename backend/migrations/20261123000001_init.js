'use strict';

/**
 * Initial schema — Dhira author platform.
 * All content tables use real foreign keys and database-level constraints.
 */

exports.up = async function up(knex) {
  await knex.schema.createTable('images', (table) => {
    table.increments('id').primary();
    table.string('filename', 255).notNullable();
    table.string('mime_type', 100).notNullable();
    table.integer('byte_size').notNullable();
    table.string('checksum', 64).notNullable();
    table.binary('data').notNullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.index(['created_at'], 'images_created_at_index');
  });

  await knex.schema.createTable('admins', (table) => {
    table.increments('id').primary();
    table.string('username', 100).notNullable().unique();
    table.text('password_hash').notNullable();
    table.integer('failed_attempts').notNullable().defaultTo(0);
    table.timestamp('locked_until');
    table.timestamp('last_login_at');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('sessions', (table) => {
    table.increments('id').primary();
    table.string('token_hash', 64).notNullable().unique();
    table
      .integer('admin_id')
      .notNullable()
      .references('id')
      .inTable('admins')
      .onDelete('CASCADE')
      .onUpdate('CASCADE');
    table.timestamp('expires_at').notNullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.string('ip_hash', 64);
    table.string('user_agent', 300);
    table.index(['expires_at'], 'sessions_expires_at_index');
  });

  await knex.schema.createTable('categories', (table) => {
    table.increments('id').primary();
    table.string('slug', 90).notNullable().unique();
    table.string('name', 100).notNullable();
    table.string('description', 300).notNullable().defaultTo('');
    table.integer('sort_order').notNullable().defaultTo(0);
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('posts', (table) => {
    table.increments('id').primary();
    table.string('slug', 100).notNullable().unique();
    table.string('title', 300).notNullable();
    table.string('subtitle', 300).notNullable().defaultTo('');
    table.text('content').notNullable();
    table.string('excerpt', 500).notNullable().defaultTo('');
    table
      .integer('category_id')
      .notNullable()
      .references('id')
      .inTable('categories')
      .onDelete('RESTRICT')
      .onUpdate('CASCADE');
    table.enu('type', ['poem', 'article'], { useNative: false }).notNullable().defaultTo('article');
    table.enu('status', ['draft', 'published'], { useNative: false }).notNullable().defaultTo('draft');
    table.boolean('featured').notNullable().defaultTo(false);
    table
      .integer('cover_image_id')
      .references('id')
      .inTable('images')
      .onDelete('SET NULL')
      .onUpdate('CASCADE');
    table.date('published_on');
    table.integer('reading_minutes').notNullable().defaultTo(1);
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    table.index(['status', 'published_on'], 'posts_status_published_on_index');
    table.index(['status', 'featured'], 'posts_status_featured_index');
    table.index(['category_id', 'status'], 'posts_category_status_index');
  });

  await knex.schema.createTable('tags', (table) => {
    table.increments('id').primary();
    table.string('slug', 90).notNullable().unique();
    table.string('name', 80).notNullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('post_tags', (table) => {
    table
      .integer('post_id')
      .notNullable()
      .references('id')
      .inTable('posts')
      .onDelete('CASCADE')
      .onUpdate('CASCADE');
    table
      .integer('tag_id')
      .notNullable()
      .references('id')
      .inTable('tags')
      .onDelete('CASCADE')
      .onUpdate('CASCADE');
    table.primary(['post_id', 'tag_id']);
    table.index(['tag_id'], 'post_tags_tag_id_index');
  });

  await knex.schema.createTable('book_info', (table) => {
    table.integer('id').primary().defaultTo(1);
    table.string('title', 200).notNullable();
    table.string('subtitle', 300).notNullable().defaultTo('');
    table.text('introduction').notNullable().defaultTo('');
    table.text('synopsis').notNullable().defaultTo('');
    table.integer('progress_percent').notNullable().defaultTo(0);
    table.string('progress_note', 120).notNullable().defaultTo('');
    table.enu(
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

  await knex.schema.createTable('author_profile', (table) => {
    table.integer('id').primary().defaultTo(1);
    table.string('name', 120).notNullable();
    table.string('pen_name', 120).notNullable().defaultTo('');
    table.string('tagline', 240).notNullable().defaultTo('');
    table.text('introduction').notNullable().defaultTo('');
    table.text('biography').notNullable().defaultTo('');
    table.string('writing_interests', 500).notNullable().defaultTo('');
    table.text('personal_description').notNullable().defaultTo('');
    table
      .integer('profile_image_id')
      .references('id')
      .inTable('images')
      .onDelete('SET NULL')
      .onUpdate('CASCADE');
    table.string('public_email', 200);
    table.string('location', 120).notNullable().defaultTo('');
    // Stored as JSON text; serialize.js parses it back into an object.
    table.text('social_links').notNullable().defaultTo('{}');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('messages', (table) => {
    table.increments('id').primary();
    table.string('name', 100).notNullable();
    table.string('email', 200).notNullable();
    table.string('subject', 200).notNullable();
    table.text('message').notNullable();
    table
      .enu('category', ['general', 'reader', 'book', 'poetry', 'other'], { useNative: false })
      .notNullable()
      .defaultTo('general');
    table.boolean('is_read').notNullable().defaultTo(false);
    table.timestamp('read_at');
    table.string('ip_hash', 64);
    table.string('user_agent', 300);
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

    table.index(['is_read', 'created_at'], 'messages_read_created_index');
    table.index(['created_at'], 'messages_created_at_index');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('messages');
  await knex.schema.dropTableIfExists('author_profile');
  await knex.schema.dropTableIfExists('book_updates');
  await knex.schema.dropTableIfExists('book_info');
  await knex.schema.dropTableIfExists('post_tags');
  await knex.schema.dropTableIfExists('tags');
  await knex.schema.dropTableIfExists('posts');
  await knex.schema.dropTableIfExists('categories');
  await knex.schema.dropTableIfExists('sessions');
  await knex.schema.dropTableIfExists('admins');
  await knex.schema.dropTableIfExists('images');
};
