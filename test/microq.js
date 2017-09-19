const { expect } = require('chai');

const mongoist = require('mongoist');
const microq = require('..');

const connectionUrl = 'mongodb://localhost/microqtests';

const db = mongoist(connectionUrl);
const jobs = db.jobs;

describe('microq', function() {
  this.timeout(5000);

  beforeEach(() => jobs.remove({}));

  it('should enqueue jobs', async () => {
    const queue = microq(connectionUrl);

    const job = await queue.enqueue('jobName', { foo: 'bar' });
    expect(job).to.exist;

    const persistedJobs = await jobs.find({});

    expect(persistedJobs).to.have.length(1);

    expect(persistedJobs[0]._id).to.exist;
    expect(persistedJobs[0].name).to.equal('jobName');
    expect(persistedJobs[0].params).to.deep.equal({ foo: 'bar' });
    expect(persistedJobs[0].priority).to.be.null;
  });

  it('should dequeue jobs', async () => {
    const queue = microq(connectionUrl);

    await queue.enqueue('jobName', { foo: 'bar' });
    
    return new Promise((resolve) => {
      queue.start({
        jobName: (params) => {
          expect(params).to.deep.equal({ foo: 'bar' });
          resolve();
        }
      }, { interval: 500 });
    });
  });

  it('should recover dequeued but not completed or failed jobs', async () => {
    const queue = microq(connectionUrl);

    const job = await queue.enqueue('jobName', { foo: 'bar' });
    
    await jobs.update({ _id: job._id}, { $set: { status: 'dequeued' }});

    return new Promise((resolve) => {
      queue.start({
        jobName: resolve
      }, { 
        interval: 500,
        recover: true 
      });
    });
  });

  it('should fire empty events if no jobs found in queue', async () => {
    const queue = microq(connectionUrl);

    return new Promise((resolve) => {
      queue.on('empty', resolve);

      queue.start({ jobName: resolve }, { interval: 500 });
    });
  });

  it('should fire failed events if a job fails', async () => {
    const queue = microq(connectionUrl);

    await queue.enqueue('jobName', { foo: 'bar' });

    return new Promise((resolve) => {
      queue.on('failed', resolve);

      queue.start({
        jobName: () => {
          throw new Error('does not work');
        }
      }, { interval: 500 });
    });
  });

  it('should fire completed events if a job completes without an error', async () => {
    const queue = microq(connectionUrl);

    await queue.enqueue('jobName', { foo: 'bar' });

    return new Promise((resolve) => {
      queue.on('completed', resolve);

      queue.start({ jobName: resolve }, { interval: 500 });
    });
  });

  it('should allow querying for jobs', async () => {
    const queue = microq(connectionUrl);

    await queue.enqueue('jobName', { foo: 'bar' });

    const enqueuedJobs = await queue.query();
    expect(enqueuedJobs).to.have.length(1);

    const dequeuedJobs = await queue.query('dequeued');
    expect(dequeuedJobs).to.have.length(0);
  });

  it('should execute jobs serial if specified', async () => {
    const queue = microq(connectionUrl);
    
    await queue.enqueue('jobName', { foo: 1 });
    await queue.enqueue('jobName', { foo: 2 });

    return new Promise((resolve, reject) => {
      queue.on('empty', resolve);

      let runningJobs = 0;

      queue.start({
        jobName: async () => {
          if (runningJobs > 0) {
            reject(new Error('Another job is running...'));
          }

          runningJobs++;

          await timeout(500);
          
          if (runningJobs != 1) {
            reject(new Error('Another job was started...'));
          }

          runningJobs--;
        }
      }, { interval: 100, parallel: false });
    });
  });

  it('should execute jobs in parallel if specified', async () => {
    const queue = microq(connectionUrl);
    
    await queue.enqueue('jobName', { foo: 1 });
    await queue.enqueue('jobName', { foo: 2 });

    return new Promise((resolve) => {
      let runningJobs = 0;
      const startJob = () => {
        runningJobs++;

        if (runningJobs == 2) {
          resolve();
        }
      }

      queue.start({
        jobName: async () => {
          startJob();

          await timeout(500);
        }
      }, { interval: 100, parallel: true });
    });
  });
});

function timeout(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}