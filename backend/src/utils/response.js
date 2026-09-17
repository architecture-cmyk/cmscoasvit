export function ok(res, data = null, message = 'Request completed successfully', meta = {}) {
  return res.status(200).json({ success: true, data, message, ...meta });
}

export function created(res, data = null, message = 'Created successfully') {
  return res.status(201).json({ success: true, data, message });
}

export function buildPagination(page, perPage, total) {
  return {
    pagination: {
      page,
      perPage,
      total,
      totalPages: Math.max(1, Math.ceil(total / perPage)),
    },
  };
}

export function parsePagination(query) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const perPage = Math.min(100, Math.max(1, parseInt(query.per_page, 10) || 20));
  return { page, perPage, from: (page - 1) * perPage, to: page * perPage - 1 };
}