const { ZodError } = require('zod');

function validate(schema) {
  return (req, res, next) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (err) {
      if (err.name === 'ZodError') {
        const firstError = err.issues[0];
        const fieldName = (firstError.path && firstError.path.join('.')) || 'unknown';
        return res.status(400).json({
          error: firstError.message,
          field: fieldName
        });
      }
      return res.status(500).json({ error: 'Validation failed' });
    }
  };
}

module.exports = validate;
