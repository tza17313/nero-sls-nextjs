/**
 * 基于/node_modules/tencent-component-toolkit/src/modules/cos/index.js 修改，去除部分需要的逻辑
 * @type {COS}
 */
const COS = require('cos-nodejs-sdk-v5');
const util = require('util');
const path = require('path');
const fs = require('fs');
const exec = util.promisify(require('child_process').exec);
const { traverseDirSync } = require('./utils/index');
const { TypeError, ApiError } = require('./utils/error');

class Cos {
  constructor(credentials = {}, region = 'ap-guangzhou') {
    this.region = region;
    this.credentials = credentials;
    // cos临时密钥需要用XCosSecurityToken
    if (credentials.token) {
      this.credentials.XCosSecurityToken = credentials.token;
    }
    if (credentials.Token) {
      this.credentials.XCosSecurityToken = credentials.Token;
    }
    this.cosClient = new COS(this.credentials);
  }

  promisify(callback) {
    return (params) => {
      return new Promise((resolve, reject) => {
        callback(params, (err, res) => {
          if (err) {
            if (typeof err.error === 'string') {
              reject(new Error(err.error));
            }
            const errMsg = err.error.Message
              ? `${err.error.Message} (reqId: ${err.error.RequestId})`
              : `${JSON.stringify(err.error)}`;

            const e = new Error(errMsg);
            if (err.error && err.error.Code) {
              // Conflict request, just resolve
              if (err.error.Code === 'PathConflict') {
                resolve(true);
              }
              e.code = err.error.Code;
              e.reqId = err.error.RequestId;
            }
            reject(e);
          }
          resolve(res);
        });
      });
    };
  }

  async upload(inputs = {},logRequestInfo=false) {
    const { bucket } = inputs;
    const { region } = this;

    if (!bucket) {
      throw new TypeError(`PARAMETER_COS`, 'Bucket name is required');
    }

    console.log(`Uploding files to ${this.region}'s bucket: ${inputs.bucket}`);
    if (inputs.dir && (await fs.existsSync(inputs.dir))) {
      const options = { keyPrefix: inputs.keyPrefix };

      const items = await new Promise((resolve, reject) => {
        try {
          resolve(traverseDirSync(inputs.dir));
        } catch (error) {
          reject(error);
        }
      });

      let handler;
      let key;
      const uploadItems = [];
      items.forEach((item) => {
        // 如果是文件夹跳过
        if (item.stats.isDirectory()) {
          return;
        }

        key = path.relative(inputs.dir, item.path);
        if (options.keyPrefix) {
          key = path.posix.join(options.keyPrefix, key);
        }

        if (path.sep === '\\') {
          key = key.replace(/\\/g, '/');
        }

        const itemParams = {
          Bucket: bucket,
          Region: region,
          Key: key,
          Body: fs.createReadStream(item.path),
        };
        handler = this.promisify(this.cosClient.putObject.bind(this.cosClient));
        uploadItems.push(handler(itemParams));
      });
      try {
        let temp=await Promise.all(uploadItems);
        if(logRequestInfo === true){
          console.log('uploadItems:', temp)
        }
      } catch (e) {
        throw new ApiError({
          type: `API_COS_putObject`,
          message: e.message,
          stack: e.stack,
          reqId: e.reqId,
          code: e.code,
        });
      }
    } else if (inputs.file && (await fs.existsSync(inputs.file))) {
      const itemParams = {
        Bucket: bucket,
        Region: region,
        Key: inputs.key || path.basename(inputs.file),
        Body: fs.createReadStream(inputs.file),
      };
      const handler = this.promisify(this.cosClient.putObject.bind(this.cosClient));
      try {
        await handler(itemParams);
      } catch (e) {
        throw new ApiError({
          type: `API_COS_putObject`,
          message: e.message,
          stack: e.stack,
          reqId: e.reqId,
          code: e.code,
        });
      }
    }
  }

  async deploy(inputs = {}) {

    if (inputs.src) {
      // upload
      const dirToUploadPath = inputs.src;
      const uploadDict = {
        bucket: inputs.bucket,
        keyPrefix: inputs.keyPrefix || '/',
      };

      if (fs.lstatSync(dirToUploadPath).isDirectory()) {
        uploadDict.dir = dirToUploadPath;
      } else {
        uploadDict.file = dirToUploadPath;
      }
      await this.upload(uploadDict,inputs.logRequestInfo);
    }
    return inputs;
  }

  async remove(inputs = {}) {
    console.log(`禁用remove，请登录网站删除`);

  }
}

module.exports = Cos;
