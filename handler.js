jsdom = require('jsdom').jsdom;

r = require('readability-node');
var bunyan = require('bunyan');
var AWS = require('aws-sdk');

const uuidV4 = require('uuid/v4');

var LOG = bunyan.createLogger({name: 'readability'});

var S3 = new AWS.S3();

function uploadToS3(content, callback) {
    key = 'messages/' + uuidV4()
    S3.putObject({
        Bucket: 'keendly',
        Key: key,
        Body: JSON.stringify(content)
    }, function (err, data) {
        if (err) {
            throw err;
        } else {
            console.log(key)
            callback(null, key)
        }
     });
}

exports.myHandler = function(event, context, callback) {
    // do not wait for all requests to finish, exit after timeout
    context.callbackWaitsForEmptyEventLoop = false

    var waitForMe = []
    var urls = {}
    p = new Promise(function(resolve) {
            S3.getObject({
                'Bucket': 'keendly',
                'Key': event
            }, function(err, data) {
                if (err){
                    LOG.info('No need to download items')
                } else {
                    LOG.info('Downloaded items from s3')
                    urls = JSON.parse(data.Body.toString('utf-8'))
                }
                resolve()
            });
    })

    var ret = {}
    p.then(function() {
        for (var url in urls) {
            LOG.info('Processing ' + url)
            try {
                var doc = jsdom(urls[url], {features: {
                                    FetchExternalResources: false,
                                    ProcessExternalResources: false
                                }});
                var article = new r.Readability(url, doc).parse();
                if (article && article.content){
                    LOG.info({event: 'extracted', url: url});
                    ret[url] = article.content
                } else {
                    LOG.warn({event: 'empty', url: url});
                    // TODO remove it
//                    ret.push({
//                        'url': url,
//                        'text': "Couldnt extract from: " + body
//                    })
                }
            } catch (error) {
                LOG.error({event: 'extract_error', url: url, error: error});
                // TODO remove it
//                ret.push({
//                    'url': url,
//                    'text': "Error extracting " + error
//                })
            }
        }
        LOG.info({event: 'finished'})
        uploadToS3(ret, callback)
    })
}
