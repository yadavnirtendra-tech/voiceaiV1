/**
 * Utility for structured API responses
 */

export const successResponse = (res, data, message = 'Success', statusCode = 200) => {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
  });
};

export const errorResponse = (res, error, message = 'An error occurred', statusCode = 500) => {
  const isProduction = process.env.NODE_ENV === 'production';
  return res.status(statusCode).json({
    success: false,
    message,
    error: isProduction ? undefined : error?.message || error,
  });
};
