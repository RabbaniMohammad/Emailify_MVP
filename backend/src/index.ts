// Load environment variables first
import 'dotenv/config';

import logger from 'jet-logger';

import ENV from '@src/common/constants/ENV';
import server from './server';
import { memoryMonitor } from '@src/services/memoryMonitor';


/******************************************************************************
                                Constants
******************************************************************************/

const SERVER_START_MSG = (
  'Express server started on port: ' + ENV.Port.toString()
);


/******************************************************************************
                                  Run
******************************************************************************/

// Start the server
server.listen(ENV.Port, err => {
  if (!!err) {
    logger.err(err.message);
  } else {
    logger.info(SERVER_START_MSG);
    
    // Start memory monitoring (always enabled for safety)
    memoryMonitor.start();
  }
});
