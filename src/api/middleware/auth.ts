import * as _ from 'lodash';
import { Request, Response, NextFunction } from 'express';

export function authCheck(req: Request, res: Response, next: NextFunction) {
  if (!_.get((req as any).nms, ['config', 'api', 'token'])) {
    return next();
  }

  if (
    _.get((req as any).nms, ['config', 'api', 'token']) !== req.headers.token
  ) {
    return res.status(401).json({ error: 'not_authorized' });
  }

  next();
}
